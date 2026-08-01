import { cfg, LINEFIT_SHAPES } from "./config.js";
import { canPlaceShapeAnywhere, canPlaceShapeAt } from "./engine.js";
import { OPERATION_CLEARING, OPERATION_IDLE, PHASE_RUNNING } from "./runtime.js";

export function createLineFitRenderer({
  gameZone,
  runtime,
  performanceMeter,
  readBN = () => performance.now(),
}) {
  const boardElement = gameZone.querySelector("[data-linefit-board]");
  const boardGrid = gameZone.querySelector("[data-linefit-grid]");
  const trayElement = gameZone.querySelector("[data-linefit-tray]");
  const boardCells = createBoardCells(boardGrid, cfg.BoardSize ** 2);
  const traySlots = createTraySlots(trayElement, cfg.TraySize);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let renderTimer = null;
  let visible = !document.hidden;
  let destroyed = false;
  let renderedBoard = null;
  let renderedTray = null;
  let renderedTransition = null;
  let renderedAvailability = "";
  let activeDrag = null;

  boardElement.style.setProperty("--board-size", String(cfg.BoardSize));
  trayElement.style.setProperty("--tray-grid-size", String(cfg.TrayGridSize));

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
    if (snapshot) paintSnapshot(snapshot);
    performanceMeter.recordFrame(readBN());
    schedule();
  }

  function paintSnapshot(snapshot) {
    const animateClear = snapshot.phase === PHASE_RUNNING &&
      snapshot.operation === OPERATION_CLEARING && snapshot.transition && !reducedMotion.matches;
    const shownBoard = animateClear ? snapshot.transition.placedBoard : snapshot.board;
    const shownTransition = animateClear ? snapshot.transition : null;
    if (shownBoard !== renderedBoard || shownTransition !== renderedTransition) {
      const clearing = new Set(shownTransition?.clearedIndexes ?? []);
      const newlyPlaced = new Set(shownTransition?.placedIndexes ?? []);
      for (let index = 0; index < boardCells.length; index += 1) {
        const cell = boardCells[index];
        cell.classList.toggle("is-filled", shownBoard[index] === 1);
        cell.classList.toggle("is-clearing", clearing.has(index));
        cell.classList.toggle("is-new", newlyPlaced.has(index));
      }
      renderedBoard = shownBoard;
      renderedTransition = shownTransition;
    }

    const availability = `${snapshot.phase}:${snapshot.operation}:${snapshot.board}:${snapshot.tray}`;
    if (snapshot.tray !== renderedTray || snapshot.board !== renderedBoard || availability !== renderedAvailability) {
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
    slot.append(createPreview(shape));
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
    cancelDrag();
    return result;
  }

  function startDrag(context, x, y) {
    cancelDrag();
    const snapshot = runtime.snapshot();
    if (snapshot?.phase !== PHASE_RUNNING || snapshot.operation !== OPERATION_IDLE || snapshot.tray[context.trayIndex] !== context.shapeIndex) return;
    const shape = LINEFIT_SHAPES[context.shapeIndex];
    const floating = createFloating(shape);
    document.body.append(floating);
    activeDrag = { context, shape, floating, row: null, column: null, valid: false, preview: [] };
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
    },
  });
}

export function getEnergyProgress(energy, energyCfg = cfg) {
  if (!Number.isSafeInteger(energy) || energy < 0) throw new RangeError("energy must be a nonnegative safe integer");
  const green = energyCfg.EnergyGreenThreshold;
  const orange = energyCfg.EnergyOrangeThreshold;
  const purple = energyCfg.EnergyPurpleThreshold;
  if (energy >= purple) return 1;
  if (energy >= orange) return (2 + (energy - orange) / (purple - orange)) / 3;
  if (energy >= green) return (1 + (energy - green) / (orange - green)) / 3;
  return energy / green / 3;
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

function createPreview(shape) {
  const preview = document.createElement("span");
  preview.className = "linefit-piece-preview";
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

function createFloating(shape) {
  const floating = document.createElement("div");
  floating.className = "linefit-floating";
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
