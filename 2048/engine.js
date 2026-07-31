const DIRECTIONS = new Set(["north", "east", "south", "west"]);

export function validate2048Config(cfg) {
  if (!cfg || typeof cfg !== "object") fail("cfg");
  if (!Number.isSafeInteger(cfg.BoardSize) || cfg.BoardSize < 2) fail("BoardSize");
  const cellCount = cfg.BoardSize ** 2;
  if (!Number.isSafeInteger(cellCount)) fail("BoardSize");
  if (!Number.isSafeInteger(cfg.InitialTileCount) || cfg.InitialTileCount < 1 || cfg.InitialTileCount > cellCount) fail("InitialTileCount");
  if (cfg.SpawnTileCount !== 1) fail("SpawnTileCount");
  for (const key of ["SpawnTwoWeight", "SpawnFourWeight"]) {
    if (!Number.isSafeInteger(cfg[key]) || cfg[key] < 0) fail(key);
  }
  const spawnWeight = cfg.SpawnTwoWeight + cfg.SpawnFourWeight;
  if (!Number.isSafeInteger(spawnWeight) || spawnWeight <= 0 || spawnWeight > 0x1_0000_0000) fail("spawnWeight");
  if (!Number.isSafeInteger(cfg.PrepareMS) || cfg.PrepareMS < 0) fail("PrepareMS");
  for (const key of [
    "EnergyInitial", "EnergyChargeMultiplier", "EnergyDecayMS", "EnergyDecayDelta",
    "EnergyGreenThreshold", "EnergyOrangeThreshold", "EnergyPurpleThreshold",
    "ScoreEnergyDivisor",
    "EnergyBarHeightPx", "EnergyBarMultiplierWidthPx", "EnergyBarArcMS", "EnergyBarTransitionMS",
  ]) {
    if (!Number.isSafeInteger(cfg[key]) || cfg[key] <= 0) fail(key);
  }
  if (!(cfg.EnergyGreenThreshold < cfg.EnergyOrangeThreshold &&
    cfg.EnergyOrangeThreshold < cfg.EnergyPurpleThreshold)) fail("energy thresholds");
  for (const key of ["EnergyBarIdleColor", "EnergyBarGreenColor", "EnergyBarOrangeColor", "EnergyBarPurpleColor"]) {
    if (typeof cfg[key] !== "string" || cfg[key].trim() === "") fail(key);
  }
  for (const key of ["SwipeThresholdPx", "MoveMS", "PumpWaitMS", "RenderWaitMS", "PerformanceWindowMS"]) {
    if (!Number.isFinite(cfg[key]) || cfg[key] <= 0) fail(key);
  }
  return true;
}

export function validateBoard(board, size) {
  if (!Number.isSafeInteger(size) || size < 2 || !Array.isArray(board) || board.length !== size ** 2) fail("board");
  for (const value of board) {
    if (!Number.isSafeInteger(value) || value < 0 || (value !== 0 && !isPowerOfTwo(value))) fail("board tile");
  }
  return true;
}

export function moveBoard(board, size, direction) {
  validateBoard(board, size);
  if (!DIRECTIONS.has(direction)) throw new RangeError("direction must be north, east, south, or west");

  const next = Array(board.length).fill(0);
  const motions = [];
  let scoreDelta = 0;

  for (const indexes of createLines(size, direction)) {
    const source = indexes
      .filter((index) => board[index] !== 0)
      .map((index) => ({ value: board[index], sources: [index] }));
    const output = [];
    for (let index = 0; index < source.length; index += 1) {
      const current = source[index];
      const following = source[index + 1];
      if (following && current.value === following.value) {
        const value = current.value * 2;
        if (!Number.isSafeInteger(value)) fail("merged tile");
        output.push({ value, sources: [...current.sources, ...following.sources], merged: true });
        scoreDelta += value;
        if (!Number.isSafeInteger(scoreDelta)) fail("scoreDelta");
        index += 1;
      } else {
        output.push({ ...current, merged: false });
      }
    }
    output.forEach((tile, outputIndex) => {
      const targetIndex = indexes[outputIndex];
      next[targetIndex] = tile.value;
      tile.sources.forEach((fromIndex) => motions.push(Object.freeze({
        fromIndex,
        toIndex: targetIndex,
        value: board[fromIndex],
        merged: tile.merged,
      })));
    });
  }

  const changed = next.some((value, index) => value !== board[index]);
  return Object.freeze({
    board: Object.freeze(next),
    changed,
    scoreDelta,
    motions: Object.freeze(motions),
  });
}

export function canMove(board, size) {
  validateBoard(board, size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const index = row * size + column;
      const value = board[index];
      if (value === 0) return true;
      if (column + 1 < size && board[index + 1] === value) return true;
      if (row + 1 < size && board[index + size] === value) return true;
    }
  }
  return false;
}

export function getMaxTile(board) {
  return board.reduce((maximum, value) => Math.max(maximum, value), 0);
}

export function dominantDirection(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    throw new RangeError("2048 direction requires finite nonzero movement");
  }
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "west" : "east";
  return dy < 0 ? "north" : "south";
}

function createLines(size, direction) {
  const lines = [];
  if (direction === "west" || direction === "east") {
    for (let row = 0; row < size; row += 1) {
      const line = [];
      for (let step = 0; step < size; step += 1) {
        const column = direction === "west" ? step : size - 1 - step;
        line.push(row * size + column);
      }
      lines.push(line);
    }
  } else {
    for (let column = 0; column < size; column += 1) {
      const line = [];
      for (let step = 0; step < size; step += 1) {
        const row = direction === "north" ? step : size - 1 - step;
        line.push(row * size + column);
      }
      lines.push(line);
    }
  }
  return lines;
}

function isPowerOfTwo(value) {
  if (value < 2) return false;
  let current = value;
  while (current % 2 === 0) current /= 2;
  return current === 1;
}

function fail(field) {
  throw new RangeError(`Invalid 2048 data: ${field}`);
}
