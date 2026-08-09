import { cfg, LINEFIT_SHAPES } from "./config.js";
import { canPlaceShapeAnywhere, canPlaceShapeAt } from "./engine.js";
import { OPERATION_CLEARING, OPERATION_IDLE, PHASE_RUNNING } from "./runtime.js";
import { createLineFitSound } from "./sound.js";
import { getPreference, subscribePreference } from "../common/storage.js";

const COLORFUL_PALETTE = Object.freeze([
  ["#ff9a9e", "#f45b69", "#9f2440"], ["#ffd36e", "#f2a93b", "#9b5c13"],
  ["#fff27a", "#d8c936", "#80731a"], ["#9cf08b", "#4dc96a", "#18713b"],
  ["#78ecc9", "#29b99a", "#12695e"], ["#80ddff", "#3ba7db", "#22598f"],
  ["#94a8ff", "#6078df", "#34418f"], ["#c5a0ff", "#8d64dc", "#573495"],
  ["#f2a1ff", "#c45bd4", "#7b2d89"], ["#ff9bd0", "#db579c", "#8f2f67"],
  ["#ffb183", "#e87545", "#934225"], ["#b9d58a", "#7cab4f", "#476a29"],
].map(Object.freeze));

export function createLineFitRenderer({
  gameZone,
  runtime,
  performanceMeter,
  readBN = () => performance.now(),
}) {
  const boardElement = gameZone.querySelector("[data-linefit-board]");
  const boardGrid = gameZone.querySelector("[data-linefit-grid]");
  const trayElement = gameZone.querySelector("[data-linefit-tray]");
  boardGrid.replaceChildren();
  trayElement.replaceChildren();
  const boardCells = createBoardCells(boardGrid, cfg.BoardSize ** 2);
  const traySlots = createTraySlots(trayElement, cfg.TraySize);
  const gamePage = gameZone.closest(".game-page");
  const soundSurface = gamePage?.querySelector(".game-button") ?? gamePage ?? gameZone;
  const sound = createLineFitSound({ surface: soundSurface });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let renderTimer = null;
  let visible = !document.hidden;
  let destroyed = false;
  let renderedBoard = null;
  let renderedTray = null;
  let renderedTransition = null;
  let renderedAvailability = "";
  let activeDrag = null;
  let pendingPlacementColor = null;
  let previousBoard = null;
  let previousPlacementCount = null;
  let trayColors = Array(cfg.TraySize).fill(null);
  const boardColors = Array(cfg.BoardSize ** 2).fill(null);
  let style = readUIStyle();

  boardElement.style.setProperty("--board-size", String(cfg.BoardSize));
  trayElement.style.setProperty("--tray-grid-size", String(cfg.TrayGridSize));
  gameZone.dataset.linefitUiStyle = style;
  const unsubscribeStyle = subscribePreference("linefitUIStyle", (value) => {
    style = value === "colorful" ? "colorful" : "duotone";
    gameZone.dataset.linefitUiStyle = style;
    cancelDrag();
    renderedBoard = null;
    renderedTray = null;
    const snapshot = runtime.snapshot();
    if (snapshot && visible && !destroyed) paintSnapshot(snapshot);
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
    if (snapshot) { sound.sync(snapshot); paintSnapshot(snapshot); }
    performanceMeter.recordFrame(readBN());
    schedule();
  }

  function paintSnapshot(snapshot) {
    const animateClear = snapshot.phase === PHASE_RUNNING &&
      snapshot.operation === OPERATION_CLEARING && snapshot.transition && !reducedMotion.matches;
    const shownBoard = animateClear ? snapshot.transition.placedBoard : snapshot.board;
    const shownTransition = animateClear ? snapshot.transition : null;
    syncBoardColors(snapshot, shownBoard, shownTransition);
    if (shownBoard !== renderedBoard || shownTransition !== renderedTransition) {
      const clearing = new Set(shownTransition?.clearedIndexes ?? []);
      const newlyPlaced = new Set(shownTransition?.placedIndexes ?? []);
      for (let index = 0; index < boardCells.length; index += 1) {
        const cell = boardCells[index];
        cell.classList.toggle("is-filled", shownBoard[index] === 1);
        cell.classList.toggle("is-clearing", clearing.has(index));
        cell.classList.toggle("is-new", newlyPlaced.has(index));
        paintColor(cell, shownBoard[index] === 1 ? boardColors[index] : null);
      }
      renderedBoard = shownBoard;
      renderedTransition = shownTransition;
    }

    const availability = `${snapshot.phase}:${snapshot.operation}:${snapshot.board}:${snapshot.tray}`;
    if (snapshot.tray !== renderedTray || snapshot.board !== renderedBoard || availability !== renderedAvailability) {
      syncTrayColors(snapshot.tray);
      for (let index = 0; index < traySlots.length; index += 1) {
        paintTraySlot(traySlots[index], index, snapshot);
      }
      renderedTray = snapshot.tray;
      renderedAvailability = availability;
    }
    if (snapshot.phase !== PHASE_RUNNING || snapshot.operation !== OPERATION_IDLE) cancelDrag();
  }

  function paintTraySlot(slot, trayIndex, snapshot) {
    const shapeIndex = snapshot.tray[trayIndex];
    slot.replaceChildren();
    slot.dataset.trayIndex = String(trayIndex);
    slot.classList.toggle("is-used", shapeIndex === null);
    if (shapeIndex === null) {
      slot.disabled = true;
      slot.removeAttribute("aria-label");
      return;
    }
    const shape = LINEFIT_SHAPES[shapeIndex];
    const placeable = canPlaceShapeAnywhere(snapshot.board, cfg.BoardSize, shape);
    slot.dataset.shapeIndex = String(shapeIndex);
    slot.dataset.shapeId = shape.id;
    slot.classList.toggle("is-dead", !placeable);
    slot.disabled = snapshot.phase !== PHASE_RUNNING || snapshot.operation !== OPERATION_IDLE || !placeable;
    slot.setAttribute("aria-label", `${shape.id}, ${shape.cellCount} cells`);
    slot.append(createPreview(shape, trayColors[trayIndex]));
  }

  function resolveDragContext(event) {
    const slot = event.target.closest?.("[data-tray-index]");
    if (!slot || slot.disabled) return null;
    const trayIndex = Number(slot.dataset.trayIndex);
    const shapeIndex = runtime.snapshot()?.tray[trayIndex];
    if (!Number.isSafeInteger(shapeIndex) || !LINEFIT_SHAPES[shapeIndex]) return null;
    return Object.freeze({ trayIndex, shapeIndex });
  }

  function handleDrag(event) {
    if (event.type === "dragStart") {
      startDrag(event.context, event.x, event.y);
      return null;
    }
    if (event.type === "dragMove") {
      moveDrag(event.x, event.y);
      return null;
    }
    if (event.type === "dragCancel") {
      cancelDrag();
      return null;
    }
    if (event.type !== "dragEnd") return null;
    moveDrag(event.x, event.y);
    const result = activeDrag?.valid ? Object.freeze({
      trayIndex: activeDrag.context.trayIndex,
      row: activeDrag.row,
      column: activeDrag.column,
    }) : null;
    if (result) pendingPlacementColor = activeDrag.color;
    cancelDrag();
    return result;
  }

  function startDrag(context, x, y) {
    cancelDrag();
    const snapshot = runtime.snapshot();
    if (snapshot?.phase !== PHASE_RUNNING || snapshot.operation !== OPERATION_IDLE || snapshot.tray[context.trayIndex] !== context.shapeIndex) return;
    const shape = LINEFIT_SHAPES[context.shapeIndex];
    const color = trayColors[context.trayIndex] ?? randomColorIndex();
    const floating = createFloating(shape, color);
    document.body.append(floating);
    activeDrag = { context, shape, color, floating, row: null, column: null, valid: false, preview: [] };
    traySlots[context.trayIndex].classList.add("is-dragging");
    moveDrag(x, y);
  }

  function moveDrag(x, y) {
    if (!activeDrag) return;
    const metrics = measureBoard(boardGrid, cfg.BoardSize);
    if (metrics.cellSize <= 0) return;
    const pieceWidth = activeDrag.shape.width * metrics.cellSize + (activeDrag.shape.width - 1) * metrics.gap;
    const pieceHeight = activeDrag.shape.height * metrics.cellSize + (activeDrag.shape.height - 1) * metrics.gap;
    const left = x - pieceWidth / 2;
    const top = y - pieceHeight - cfg.DragLiftCells * metrics.cellSize;
    activeDrag.floating.style.setProperty("--drag-cell-size", `${metrics.cellSize}px`);
    activeDrag.floating.style.setProperty("--drag-gap", `${metrics.gap}px`);
    activeDrag.floating.style.transform = `translate(${left}px, ${top}px)`;

    const column = Math.round((left - metrics.rect.left) / metrics.step);
    const row = Math.round((top - metrics.rect.top) / metrics.step);
    const snapshot = runtime.snapshot();
    const valid = snapshot?.phase === PHASE_RUNNING && snapshot.operation === OPERATION_IDLE &&
      snapshot.tray[activeDrag.context.trayIndex] === activeDrag.context.shapeIndex &&
      canPlaceShapeAt(snapshot.board, cfg.BoardSize, activeDrag.shape, row, column);
    clearPreview(activeDrag.preview);
    activeDrag.preview = [];
    activeDrag.row = row;
    activeDrag.column = column;
    activeDrag.valid = Boolean(valid);
    activeDrag.floating.classList.toggle("is-valid", Boolean(valid));
    if (valid) {
      for (const cell of activeDrag.shape.cells) {
        const index = (row + cell.row) * cfg.BoardSize + column + cell.column;
        boardCells[index].classList.add("is-preview");
        activeDrag.preview.push(index);
      }
    }
  }

  function cancelDrag() {
    if (!activeDrag) return;
    clearPreview(activeDrag.preview);
    traySlots[activeDrag.context.trayIndex]?.classList.remove("is-dragging");
    activeDrag.floating.remove();
    activeDrag = null;
  }

  function syncBoardColors(snapshot, shownBoard, shownTransition) {
    if (previousPlacementCount !== snapshot.placementCount) {
      const placedIndexes = shownTransition?.placedIndexes ?? shownBoard.flatMap((filled, index) =>
        filled === 1 && previousBoard?.[index] !== 1 ? [index] : []);
      const color = pendingPlacementColor ?? randomColorIndex();
      for (const index of placedIndexes) boardColors[index] = color;
      pendingPlacementColor = null;
    }
    for (let index = 0; index < shownBoard.length; index += 1) {
      if (shownBoard[index] === 1 && boardColors[index] === null) boardColors[index] = randomColorIndex();
      if (shownBoard[index] !== 1) boardColors[index] = null;
    }
    previousBoard = snapshot.board;
    previousPlacementCount = snapshot.placementCount;
  }

  function syncTrayColors(tray) {
    const previousCount = renderedTray?.filter(Number.isSafeInteger).length ?? 0;
    const nextCount = tray.filter(Number.isSafeInteger).length;
    if (!renderedTray || (nextCount === cfg.TraySize && previousCount <= 1)) {
      trayColors = distinctColorIndexes(cfg.TraySize);
      return;
    }
    for (let index = 0; index < tray.length; index += 1) {
      if (!Number.isSafeInteger(tray[index])) trayColors[index] = null;
      else if (trayColors[index] === null) trayColors[index] = randomColorIndex();
    }
  }

  function schedule(delay = cfg.RenderWaitMS) {
    if (destroyed || !visible || renderTimer !== null) return;
    renderTimer = setTimeout(render, delay);
  }

  render();

  return Object.freeze({
    resolveDragContext,
    handleDrag,
    cancelDrag,
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      sound.setVisible(visible);
      if (!visible) {
        cancelDrag();
        if (renderTimer !== null) clearTimeout(renderTimer);
        renderTimer = null;
      } else {
        render();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelDrag();
      if (renderTimer !== null) clearTimeout(renderTimer);
      renderTimer = null;
      sound.destroy();
      unsubscribeStyle();
    },
  });
}

function createBoardCells(parent, count) {
  return Array.from({ length: count }, (_, index) => {
    const cell = document.createElement("span");
    cell.className = "linefit-cell";
    cell.dataset.cellIndex = String(index);
    cell.setAttribute("aria-hidden", "true");
    parent.append(cell);
    return cell;
  });
}

function createTraySlots(parent, count) {
  return Array.from({ length: count }, (_, index) => {
    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "linefit-tray-slot";
    slot.dataset.trayIndex = String(index);
    parent.append(slot);
    return slot;
  });
}

function createPreview(shape, color) {
  const preview = document.createElement("span");
  preview.className = "linefit-piece-preview";
  paintColor(preview, color);
  const rowOffset = Math.floor((cfg.TrayGridSize - shape.height) / 2);
  const columnOffset = Math.floor((cfg.TrayGridSize - shape.width) / 2);
  const occupied = new Set(shape.cells.map((cell) => `${cell.row + rowOffset},${cell.column + columnOffset}`));
  for (let row = 0; row < cfg.TrayGridSize; row += 1) {
    for (let column = 0; column < cfg.TrayGridSize; column += 1) {
      const cell = document.createElement("i");
      if (occupied.has(`${row},${column}`)) cell.className = "is-piece";
      preview.append(cell);
    }
  }
  return preview;
}

function createFloating(shape, color) {
  const floating = document.createElement("div");
  floating.className = "linefit-floating";
  floating.dataset.linefitUiStyle = readUIStyle();
  paintColor(floating, color);
  floating.style.setProperty("--shape-columns", String(shape.width));
  floating.style.setProperty("--shape-rows", String(shape.height));
  const occupied = new Set(shape.cells.map((cell) => `${cell.row},${cell.column}`));
  for (let row = 0; row < shape.height; row += 1) {
    for (let column = 0; column < shape.width; column += 1) {
      const cell = document.createElement("i");
      if (occupied.has(`${row},${column}`)) cell.className = "is-piece";
      floating.append(cell);
    }
  }
  return floating;
}

function measureBoard(element, size) {
  const rect = element.getBoundingClientRect();
  const gap = Number.parseFloat(getComputedStyle(element).gap) || 0;
  const cellSize = (rect.width - gap * (size - 1)) / size;
  return { rect, gap, cellSize, step: cellSize + gap };
}

function clearPreview(indexes) {
  for (const index of indexes ?? []) document.querySelector(`[data-linefit-grid] [data-cell-index="${index}"]`)?.classList.remove("is-preview");
}

function readUIStyle() {
  return getPreference("linefitUIStyle", "colorful") === "duotone" ? "duotone" : "colorful";
}

function randomColorIndex() {
  return Math.floor(Math.random() * COLORFUL_PALETTE.length);
}

function distinctColorIndexes(count) {
  const indexes = Array.from({ length: COLORFUL_PALETTE.length }, (_, index) => index);
  for (let index = indexes.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [indexes[index], indexes[swap]] = [indexes[swap], indexes[index]];
  }
  return indexes.slice(0, count);
}

function paintColor(element, colorIndex) {
  if (!Number.isSafeInteger(colorIndex) || !COLORFUL_PALETTE[colorIndex]) {
    element.style.removeProperty("--linefit-color-top");
    element.style.removeProperty("--linefit-color-middle");
    element.style.removeProperty("--linefit-color-bottom");
    return;
  }
  const [top, middle, bottom] = COLORFUL_PALETTE[colorIndex];
  element.style.setProperty("--linefit-color-top", top);
  element.style.setProperty("--linefit-color-middle", middle);
  element.style.setProperty("--linefit-color-bottom", bottom);
}
