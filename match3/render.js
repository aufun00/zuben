import { TILE_CATALOG, cfg } from "./config.js";
import { OPERATION_RESOLVE, OPERATION_SWAP, OPERATION_SWAP_BACK, PHASE_RUNNING } from "./runtime.js";
import { createMatch3Sound } from "./sound.js";

const PIECE_URLS = TILE_CATALOG.map((_, index) => new URL(`./piece-${index + 1}O.svg`, import.meta.url).href);
const MOVE_EASING = "cubic-bezier(.33,1,.68,1)";
const RASTER_MARGIN = 1.25;
const RASTER_SIZES = Object.freeze([64, 128, 256, 512]);

export function createMatch3Renderer({ gameZone, runtime, performanceMeter, readBN = () => performance.now() }) {
  const board = gameZone.querySelector("[data-match3-board]");
  const gamePage = gameZone.closest(".game-page");
  const soundSurface = gamePage?.querySelector(".game-button") ?? gamePage ?? gameZone;
  const sound = createMatch3Sound({ surface: soundSurface, durationMS: cfg.ClearMS + cfg.FallMS });
  const tiles = Array.from({ length: cfg.BoardSize ** 2 }, (_, index) => {
    const node = document.createElement("button");
    const pieceLayers = TILE_CATALOG.map((_, type) =>
      `<span class="match3-piece-layer" data-piece-layer="${type}" style="display:none;background-position:${type % 3 * 50}% ${Math.floor(type / 3) * 100}%"></span>`).join("");
    node.type = "button"; node.className = "match3-tile"; node.dataset.index = String(index); node.tabIndex = -1;
    node.innerHTML = `<span class="match3-crystal" aria-hidden="true">${pieceLayers}</span><span class="match3-mystery" aria-hidden="true">?</span>`;
    board.append(node);
    return Object.freeze({ node, pieceLayers: [...node.querySelectorAll("[data-piece-layer]")], mystery: node.querySelector(".match3-mystery") });
  });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let timer = null, visible = !document.hidden, destroyed = false, selected = null, lastAppearance = "", activeMotion = null, animations = [], atlasUrl = null;
  const ready = createPieceAtlas(board).then(({ url, size }) => {
    if (destroyed) { URL.revokeObjectURL(url); return; }
    atlasUrl = url;
    board.style.setProperty("--match3-piece-atlas", `url("${url}")`);
    board.dataset.rasterSize = String(size);
    board.dataset.rasterReady = "true";
  });

  function render() {
    timer = null; if (destroyed || !visible) return;
    const BN = readBN(); if (runtime.shouldYieldRender(BN)) { runtime.wakePump(); schedule(0); return; }
    const snapshot = runtime.snapshot();
    sound.sync(snapshot);
    const animated = Boolean(snapshot.phase === PHASE_RUNNING && snapshot.transition && !reducedMotion.matches);
    let types = snapshot.types, effects = snapshot.effects, clearMarks = null, effectCells = null, progress = 1, falling = false;
    if (animated) {
      const transition = snapshot.transition;
      progress = ratio(snapshot.runGT, transition.startGT, transition.endGT);
      if (snapshot.operation === OPERATION_RESOLVE && snapshot.runGT < transition.clearEndGT) {
        types = transition.beforeTypes; effects = transition.beforeEffects; clearMarks = transition.marks; effectCells = transition.effectCells;
        progress = ratio(snapshot.runGT, transition.startGT, transition.clearEndGT);
      } else if (snapshot.operation === OPERATION_RESOLVE) {
        falling = true;
        progress = ratio(snapshot.runGT, transition.clearEndGT, transition.endGT);
      } else if (snapshot.operation === OPERATION_SWAP || snapshot.operation === OPERATION_SWAP_BACK) {
        types = transition.beforeTypes; effects = transition.beforeEffects;
      }
    }
    const clearing = Boolean(clearMarks && progress > .72);
    const appearance = `${types.join(",")}|${effects.join(",")}|${effectCells?.join(",") ?? ""}|${selected}|${clearing}`;
    if (appearance !== lastAppearance) {
      const effectSet = new Set(effectCells ?? []);
      for (let index = 0; index < tiles.length; index += 1) paintAppearance(tiles[index], types[index], effects[index], index, clearMarks, effectSet, clearing);
      lastAppearance = appearance;
    }
    syncMotion(snapshot, animated, falling);
    performanceMeter.recordFrame(readBN()); schedule();
  }

  function paintAppearance(tile, type, effect, index, marks, effectSet, clearing) {
    const catalog = TILE_CATALOG[type], { node, pieceLayers, mystery } = tile;
    node.dataset.type = String(type); node.dataset.effect = String(effect); node.dataset.piece = catalog?.symbol ?? ""; node.hidden = !catalog;
    for (let layer = 0; layer < pieceLayers.length; layer += 1) pieceLayers[layer].style.display = layer === type ? "inline" : "none";
    mystery.hidden = !effect;
    node.classList.toggle("mystery", Boolean(effect));
    node.classList.toggle("selected", index === selected);
    node.classList.toggle("effect-preview", effectSet.has(index));
    node.classList.toggle("clearing", clearing && Boolean(marks?.[index]));
  }

  function syncMotion(snapshot, animated, falling) {
    const transition = snapshot.transition;
    let motion = null;
    if (animated && (snapshot.operation === OPERATION_SWAP || snapshot.operation === OPERATION_SWAP_BACK)) motion = `${snapshot.operation}:${transition.startGT}`;
    else if (animated && snapshot.operation === OPERATION_RESOLVE && falling) motion = `FALL:${transition.startGT}`;
    if (motion === activeMotion) return;
    clearMotion(); activeMotion = motion;
    if (motion === null) return;
    if (snapshot.operation === OPERATION_SWAP || snapshot.operation === OPERATION_SWAP_BACK) {
      const duration = transition.endGT - transition.startGT, elapsed = snapshot.runGT - transition.startGT;
      animateMove(transition.fromIndex, "translate(0%, 0%)", translate(transition.fromIndex, transition.toIndex), duration, elapsed);
      animateMove(transition.toIndex, "translate(0%, 0%)", translate(transition.toIndex, transition.fromIndex), duration, elapsed);
      return;
    }
    const duration = transition.endGT - transition.clearEndGT, elapsed = snapshot.runGT - transition.clearEndGT;
    for (const item of transition.motions) {
      if (item.fromIndex === item.toIndex) continue;
      animateMove(item.toIndex, translate(item.toIndex, item.fromIndex), "translate(0%, 0%)", duration, elapsed);
    }
  }

  function animateMove(index, from, to, duration, elapsed) {
    const node = tiles[index]?.node;
    if (!node || duration <= 0 || typeof node.animate !== "function") return;
    const animation = node.animate([{ transform: from }, { transform: to }], { duration, easing: MOVE_EASING, fill: "both" });
    animation.currentTime = Math.min(duration, Math.max(0, elapsed));
    animations.push(animation);
  }

  function clearMotion() {
    for (const animation of animations) animation.cancel();
    animations = []; activeMotion = null;
  }

  function translate(from, to) {
    const fromColumn = ((from % cfg.BoardSize) + cfg.BoardSize) % cfg.BoardSize;
    const toColumn = ((to % cfg.BoardSize) + cfg.BoardSize) % cfg.BoardSize;
    const x = (toColumn - fromColumn) * 100;
    const y = (Math.floor(to / cfg.BoardSize) - Math.floor(from / cfg.BoardSize)) * 100;
    return `translate(${x}%, ${y}%)`;
  }

  function schedule(delay = cfg.RenderWaitMS) { if (!destroyed && visible && timer === null) timer = setTimeout(render, delay); }
  render();
  return Object.freeze({
    ready,
    setSelected(index) { selected = index; lastAppearance = ""; },
    setVisible(value) { visible = Boolean(value); sound.setVisible(visible); if (!visible && timer !== null) { clearTimeout(timer); timer = null; } else if (visible) render(); },
    destroy() { destroyed = true; if (timer !== null) clearTimeout(timer); timer = null; clearMotion(); sound.destroy(); if (atlasUrl !== null) URL.revokeObjectURL(atlasUrl); atlasUrl = null; },
  });
}

function ratio(value, start, end) { return Math.min(1, Math.max(0, (value - start) / (end - start || 1))); }

async function createPieceAtlas(board) {
  const tileWidth = board.querySelector(".match3-tile")?.getBoundingClientRect().width || board.getBoundingClientRect().width / cfg.BoardSize;
  const requiredSize = Math.ceil(tileWidth * Math.max(1, devicePixelRatio || 1) * RASTER_MARGIN);
  const size = RASTER_SIZES.find((candidate) => candidate >= requiredSize) ?? RASTER_SIZES.at(-1);
  const images = await Promise.all(PIECE_URLS.map(loadPieceImage));
  const canvas = document.createElement("canvas");
  canvas.width = size * 3; canvas.height = size * 2;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Match3 raster canvas is unavailable");
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index], ratio = image.naturalWidth / image.naturalHeight;
    const width = ratio >= 1 ? size : size * ratio, height = ratio >= 1 ? size / ratio : size;
    const x = index % 3 * size + (size - width) / 2, y = Math.floor(index / 3) * size + (size - height) / 2;
    context.drawImage(image, x, y, width, height);
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Match3 raster encoding failed")), "image/png"));
  return Object.freeze({ url: URL.createObjectURL(blob), size });
}

function loadPieceImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not rasterize Match3 piece: ${url}`));
    image.src = url;
  });
}
