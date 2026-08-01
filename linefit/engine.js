export function validateLineFitConfig(cfg, shapes) {
  if (!cfg || typeof cfg !== "object") fail("cfg");
  for (const key of ["BoardSize", "TraySize", "TrayGridSize"]) positiveInteger(cfg, key);
  if (cfg.BoardSize < 2 || cfg.TraySize !== 3 || cfg.TrayGridSize < 1) fail("dimensions");
  if (!Number.isSafeInteger(cfg.PrepareMS) || cfg.PrepareMS < 0) fail("PrepareMS");
  for (const key of [
    "ClearMS", "DragThresholdPx", "DragLiftCells", "PlaceScorePerCell", "LineScoreMultiplier",
    "EnergyInitial", "EnergyPerCell", "EnergyDecayMS", "EnergyDecayDelta",
    "EnergyMultiplierDivisor", "EnergyMultiplierMinimum",
    "EnergyGreenThreshold", "EnergyOrangeThreshold", "EnergyPurpleThreshold",
    "PumpWaitMS", "RenderWaitMS", "PerformanceWindowMS",
  ]) positiveNumber(cfg, key);
  if (!(cfg.EnergyGreenThreshold < cfg.EnergyOrangeThreshold &&
    cfg.EnergyOrangeThreshold < cfg.EnergyPurpleThreshold)) fail("energy thresholds");
  validateShapes(shapes, cfg.TrayGridSize);
  return true;
}

export function validateShapes(shapes, maximumExtent = 5) {
  if (!Array.isArray(shapes) || shapes.length !== 19) fail("shapes");
  const ids = new Set();
  const signatures = new Set();
  for (const shape of shapes) {
    if (!shape || typeof shape.id !== "string" || shape.id === "" || ids.has(shape.id)) fail("shape id");
    ids.add(shape.id);
    if (!Number.isSafeInteger(shape.width) || !Number.isSafeInteger(shape.height) ||
      shape.width < 1 || shape.height < 1 || shape.width > maximumExtent || shape.height > maximumExtent) fail("shape extent");
    if (!Array.isArray(shape.cells) || shape.cells.length !== shape.cellCount || shape.cells.length < 1) fail("shape cells");
    const occupied = new Set();
    for (const cell of shape.cells) {
      if (!Number.isSafeInteger(cell?.row) || !Number.isSafeInteger(cell?.column) ||
        cell.row < 0 || cell.column < 0 || cell.row >= shape.height || cell.column >= shape.width) fail("shape cell");
      const key = `${cell.row},${cell.column}`;
      if (occupied.has(key)) fail("duplicate shape cell");
      occupied.add(key);
    }
    if (![...occupied].some((key) => key.startsWith("0,")) ||
      ![...occupied].some((key) => key.endsWith(",0")) ||
      ![...occupied].some((key) => key.startsWith(`${shape.height - 1},`)) ||
      ![...occupied].some((key) => key.endsWith(`,${shape.width - 1}`))) fail("untrimmed shape");
    const signature = [...occupied].sort().join(";");
    if (signatures.has(`${shape.height}x${shape.width}:${signature}`)) fail("duplicate shape");
    signatures.add(`${shape.height}x${shape.width}:${signature}`);
  }
  return true;
}

export function validateBoard(board, size) {
  if (!Number.isSafeInteger(size) || size < 2 || !Array.isArray(board) || board.length !== size ** 2) fail("board");
  for (const value of board) if (value !== 0 && value !== 1) fail("board cell");
  return true;
}

export function canPlaceShapeAt(board, size, shape, row, column) {
  validateBoard(board, size);
  if (!shape || !Array.isArray(shape.cells) || !Number.isSafeInteger(row) || !Number.isSafeInteger(column)) return false;
  if (row < 0 || column < 0 || row + shape.height > size || column + shape.width > size) return false;
  return shape.cells.every((cell) => board[(row + cell.row) * size + column + cell.column] === 0);
}

export function canPlaceShapeAnywhere(board, size, shape) {
  validateBoard(board, size);
  if (!shape || !Number.isSafeInteger(shape.width) || !Number.isSafeInteger(shape.height)) return false;
  for (let row = 0; row <= size - shape.height; row += 1) {
    for (let column = 0; column <= size - shape.width; column += 1) {
      if (canPlaceShapeAt(board, size, shape, row, column)) return true;
    }
  }
  return false;
}

export function hasAnyMove(board, size, tray, shapes) {
  validateBoard(board, size);
  if (!Array.isArray(tray)) fail("tray");
  return tray.some((shapeIndex) => shapeIndex !== null &&
    Number.isSafeInteger(shapeIndex) && shapes[shapeIndex] && canPlaceShapeAnywhere(board, size, shapes[shapeIndex]));
}

export function placeShape(board, size, shape, row, column, cfg) {
  if (!canPlaceShapeAt(board, size, shape, row, column)) return null;
  const placed = [...board];
  const placedIndexes = shape.cells.map((cell) => (row + cell.row) * size + column + cell.column);
  for (const index of placedIndexes) placed[index] = 1;

  const clearedRows = [];
  const clearedColumns = [];
  for (let boardRow = 0; boardRow < size; boardRow += 1) {
    let full = true;
    for (let boardColumn = 0; boardColumn < size; boardColumn += 1) {
      if (placed[boardRow * size + boardColumn] === 0) { full = false; break; }
    }
    if (full) clearedRows.push(boardRow);
  }
  for (let boardColumn = 0; boardColumn < size; boardColumn += 1) {
    let full = true;
    for (let boardRow = 0; boardRow < size; boardRow += 1) {
      if (placed[boardRow * size + boardColumn] === 0) { full = false; break; }
    }
    if (full) clearedColumns.push(boardColumn);
  }

  const cleared = new Set();
  for (const clearedRow of clearedRows) {
    for (let boardColumn = 0; boardColumn < size; boardColumn += 1) cleared.add(clearedRow * size + boardColumn);
  }
  for (const clearedColumn of clearedColumns) {
    for (let boardRow = 0; boardRow < size; boardRow += 1) cleared.add(boardRow * size + clearedColumn);
  }
  const next = [...placed];
  for (const index of cleared) next[index] = 0;
  const clearCount = clearedRows.length + clearedColumns.length;
  const rawScore = calculateRawScore(shape.cellCount, clearCount, cfg);
  return Object.freeze({
    board: Object.freeze(next),
    placedBoard: Object.freeze(placed),
    placedIndexes: Object.freeze(placedIndexes),
    clearedIndexes: Object.freeze([...cleared].sort((left, right) => left - right)),
    clearedRows: Object.freeze(clearedRows),
    clearedColumns: Object.freeze(clearedColumns),
    clearCount,
    cellCount: shape.cellCount,
    rawScore,
  });
}

export function calculateRawScore(cellCount, clearCount, cfg) {
  if (!Number.isSafeInteger(cellCount) || cellCount < 1 || !Number.isSafeInteger(clearCount) || clearCount < 0) {
    throw new RangeError("cellCount and clearCount must be nonnegative integers");
  }
  const placementScore = cellCount * cfg.PlaceScorePerCell;
  const score = clearCount === 0
    ? placementScore
    : placementScore * cfg.LineScoreMultiplier * clearCount ** 2;
  if (!Number.isSafeInteger(score)) fail("raw score");
  return score;
}

function positiveInteger(cfg, key) {
  if (!Number.isSafeInteger(cfg[key]) || cfg[key] <= 0) fail(key);
}

function positiveNumber(cfg, key) {
  if (!Number.isFinite(cfg[key]) || cfg[key] <= 0) fail(key);
}

function fail(field) {
  throw new RangeError(`Invalid LineFit data: ${field}`);
}
