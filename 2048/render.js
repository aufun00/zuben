import { cfg } from "./config.js";
import { OPERATION_MOVING, PHASE_RUNNING } from "./runtime.js";
import { create2048Sound } from "./sound.js";

const TILE_UNITS = Object.freeze([
  Object.freeze({ threshold: 2 ** 40, suffix: "T" }),
  Object.freeze({ threshold: 2 ** 30, suffix: "G" }),
  Object.freeze({ threshold: 2 ** 20, suffix: "M" }),
  Object.freeze({ threshold: 2 ** 10, suffix: "K" }),
]);
const TILE_PALETTES = Object.freeze([
  palette("crystal", "#8e969d", "#69737b", "#3f484f", "#b8bec3", "#f8fafb"),
  palette("crystal", "#9ca5ac", "#78828a", "#4a545c", "#c5cbd0", "#f8fafb"),
  palette("crystal", "#adb5bb", "#89939a", "#59636a", "#d2d7da", "#f8fafb"),
  palette("crystal", "#bdc3c7", "#9ba3a8", "#697278", "#dfe3e5", "#f8fafb"),
  palette("crystal", "#c9c7bd", "#aaa69a", "#797568", "#e4e1d8", "#fffdf8"),
  palette("crystal", "#d8cfad", "#bbae7f", "#8b794d", "#eee4c4", "#fffdf5"),
  palette("crystal", "#e5d694", "#ccb961", "#9c8329", "#f6e9ae", "#4a3b00"),
  palette("crystal", "#f0df7d", "#dcc449", "#aa8b12", "#fff09a", "#4a3b00"),
  palette("gold", "#ffe986", "#edc22e", "#a97408", "#fff1a8", "#4a3900"),
]);

export function create2048Renderer({
  gameZone,
  runtime,
  performanceMeter,
  readBN = () => performance.now(),
}) {
  const boardElement = gameZone.querySelector("[data-2048-board]");
  const gridLayer = gameZone.querySelector("[data-2048-grid]");
  const staticLayer = gameZone.querySelector("[data-2048-static]");
  const motionLayer = gameZone.querySelector("[data-2048-motion]");
  gridLayer.replaceChildren();
  staticLayer.replaceChildren();
  motionLayer.replaceChildren();
  const cellCount = cfg.BoardSize ** 2;
  const cells = createNodes(gridLayer, cellCount, "div", "twenty48-cell");
  const staticTiles = createNodes(staticLayer, cellCount, "div", "twenty48-tile");
  const motionTiles = createNodes(motionLayer, cellCount, "div", "twenty48-tile twenty48-motion-tile");
  const gamePage = gameZone.closest(".game-page");
  const soundSurface = gamePage?.querySelector(".game-button") ?? gamePage ?? gameZone;
  const sound = create2048Sound({ surface: soundSurface });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let boardMetrics = measureBoard(boardElement, cfg.BoardSize);
  const resizeObserver = new ResizeObserver(() => {
    boardMetrics = measureBoard(boardElement, cfg.BoardSize);
    renderedWidth = -1;
  });
  let renderTimer = null;
  let visible = !document.hidden;
  let destroyed = false;
  let renderedBoard = null;
  let renderedWidth = -1;
  let showingTransition = false;

  boardElement.style.setProperty("--board-size", String(cfg.BoardSize));
  resizeObserver.observe(boardElement);
  cells.forEach((node) => node.setAttribute("aria-hidden", "true"));
  [...staticTiles, ...motionTiles].forEach((node) => {
    node.hidden = true;
    node.setAttribute("aria-hidden", "true");
  });

  function render() {
    renderTimer = null;
    if (destroyed || !visible) return;
    const nowBN = readBN();
    if (runtime.shouldYieldRender(nowBN)) {
      runtime.wakePump();
      schedule(0);
      return;
    }
    const snapshot = runtime.snapshot();
    if (!snapshot) {
      schedule();
      return;
    }
    sound.sync(snapshot);
    const animate = snapshot.phase === PHASE_RUNNING &&
      snapshot.operation === OPERATION_MOVING &&
      snapshot.transition !== null &&
      !reducedMotion.matches;
    if (animate) renderTransition(snapshot);
    else renderSettled(snapshot.board);
    performanceMeter.recordFrame(readBN());
    schedule();
  }

  function renderSettled(board) {
    const metrics = boardMetrics;
    if (!showingTransition && board === renderedBoard && metrics.width === renderedWidth) return;
    hideNodes(motionTiles);
    for (let index = 0; index < staticTiles.length; index += 1) {
      const value = board[index];
      const node = staticTiles[index];
      if (value === 0) {
        node.hidden = true;
        continue;
      }
      paintTile(node, value);
      placeTile(node, index, index, 1, metrics);
      node.hidden = false;
    }
    renderedBoard = board;
    renderedWidth = metrics.width;
    showingTransition = false;
  }

  function renderTransition(snapshot) {
    const metrics = boardMetrics;
    hideNodes(staticTiles);
    const { transition } = snapshot;
    const duration = transition.endGT - transition.startGT;
    const progress = duration <= 0 ? 1 : clamp((snapshot.runGT - transition.startGT) / duration, 0, 1);
    const eased = 1 - (1 - progress) ** 3;
    for (let index = 0; index < motionTiles.length; index += 1) {
      const motion = transition.motions[index];
      const node = motionTiles[index];
      if (!motion) {
        node.hidden = true;
        continue;
      }
      paintTile(node, motion.value);
      placeTile(node, motion.fromIndex, motion.toIndex, eased, metrics);
      node.dataset.merged = String(motion.merged);
      node.hidden = false;
    }
    showingTransition = true;
  }

  function placeTile(node, fromIndex, toIndex, progress, metrics) {
    const from = pointForIndex(fromIndex, cfg.BoardSize, metrics);
    const to = pointForIndex(toIndex, cfg.BoardSize, metrics);
    node.style.width = `${metrics.cellSize}px`;
    node.style.height = `${metrics.cellSize}px`;
    node.style.transform = `translate(${lerp(from.x, to.x, progress)}px, ${lerp(from.y, to.y, progress)}px)`;
  }

  function schedule(delay = cfg.RenderWaitMS) {
    if (destroyed || !visible || renderTimer !== null) return;
    renderTimer = setTimeout(render, delay);
  }

  render();

  return Object.freeze({
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      sound.setVisible(visible);
      if (!visible && renderTimer !== null) {
        clearTimeout(renderTimer);
        renderTimer = null;
      } else if (visible) {
        render();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      resizeObserver.disconnect();
      if (renderTimer !== null) clearTimeout(renderTimer);
      renderTimer = null;
      sound.destroy();
    },
  });
}

export function formatTileValue(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("tile value must be a nonnegative safe integer");
  for (const unit of TILE_UNITS) {
    if (value >= unit.threshold) return `${value / unit.threshold}${unit.suffix}`;
  }
  return String(value);
}


function createNodes(parent, count, tagName, className) {
  return Array.from({ length: count }, () => {
    const node = document.createElement(tagName);
    node.className = className;
    parent.append(node);
    return node;
  });
}

function paintTile(node, value) {
  const level = Math.log2(value);
  const colors = getTilePalette(value);
  node.textContent = formatTileValue(value);
  node.dataset.level = String(level);
  node.dataset.material = colors.material;
  node.style.setProperty("--tile-top", colors.top);
  node.style.setProperty("--tile-middle", colors.middle);
  node.style.setProperty("--tile-bottom", colors.bottom);
  node.style.setProperty("--tile-border", colors.border);
  node.style.color = colors.text;
  node.style.fontSize = level >= 20 ? "clamp(13px, 4.3cqi, 24px)" : "";
}

export function getTilePalette(value) {
  if (!Number.isSafeInteger(value) || value < 2 || !Number.isInteger(Math.log2(value))) throw new RangeError("tile value must be a positive safe power of two");
  return TILE_PALETTES[Math.min(Math.log2(value) - 1, TILE_PALETTES.length - 1)];
}

function palette(material, top, middle, bottom, border, text) {
  return Object.freeze({ material, top, middle, bottom, border, text });
}

function measureBoard(element, size) {
  const width = element.clientWidth;
  const gap = Number.parseFloat(getComputedStyle(element).getPropertyValue("--board-gap")) || 8;
  return { width, gap, cellSize: (width - gap * (size - 1)) / size };
}

function pointForIndex(index, size, { cellSize, gap }) {
  return {
    x: (index % size) * (cellSize + gap),
    y: Math.floor(index / size) * (cellSize + gap),
  };
}

function hideNodes(nodes) {
  nodes.forEach((node) => { node.hidden = true; });
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
