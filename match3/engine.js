import { EFFECT_A, EFFECT_B, EFFECT_C, EFFECT_D, EFFECT_NONE, EFFECT_PRIORITY } from "./config.js";

export const EMPTY = -1;

export function validateMatch3Config(cfg) {
  const positive = ["BoardSize", "TileTypeCount", "MysteryDenominator", "EnergyDecayMS", "ScoreEnergyDivisor"];
  for (const key of positive) if (!Number.isSafeInteger(cfg[key]) || cfg[key] <= 0) throw new RangeError(`${key} must be positive`);
  if (cfg.BoardSize < 3 || cfg.TileTypeCount < 3 || cfg.TileWeights.length !== cfg.TileTypeCount) throw new RangeError("invalid board or tile catalog");
  if (cfg.EffectWeights.length !== 4 || cfg.MysteryNumerator < 0 || cfg.MysteryNumerator > cfg.MysteryDenominator) throw new RangeError("invalid mystery configuration");
  for (const value of [...cfg.TileWeights, ...cfg.EffectWeights]) if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("weights must be positive integers");
  for (const key of ["PrepareMS", "SwipeThresholdPx", "SwapMS", "SwapBackMS", "ClearMS", "FallMS", "EnergyInitial", "EnergyPerCell", "EnergyDecayDelta", "PumpWaitMS", "RenderWaitMS"]) {
    if (!Number.isSafeInteger(cfg[key]) || cfg[key] < 0) throw new RangeError(`${key} must be nonnegative`);
  }
}

export function findMatches(types, size) {
  validateBoard(types, size);
  const marked = new Uint8Array(types.length);
  for (let row = 0; row < size; row += 1) scanLine(types, marked, row * size, 1, size);
  for (let column = 0; column < size; column += 1) scanLine(types, marked, column, size, size);
  return Object.freeze(Array.from(marked, (value, index) => value ? index : -1).filter((index) => index >= 0));
}

export function boardHasLegalMove(types, size) {
  validateBoard(types, size);
  const copy = Int16Array.from(types);
  for (let index = 0; index < copy.length; index += 1) {
    const column = index % size;
    for (const other of [column + 1 < size ? index + 1 : -1, index + size < copy.length ? index + size : -1]) {
      if (other < 0 || copy[index] === copy[other]) continue;
      swap(copy, index, other);
      const valid = findMatches(copy, size).length > 0;
      swap(copy, index, other);
      if (valid) return true;
    }
  }
  return false;
}

export function buildClearPlan(types, effects, size, naturalCells) {
  validateBoard(types, size);
  if (effects.length !== types.length) throw new RangeError("effects length must match board");
  const marks = new Uint16Array(types.length);
  for (const index of naturalCells) {
    if (!isIndex(index, marks.length)) throw new RangeError("invalid natural match index");
    marks[index] = 1;
  }
  if (naturalCells.length === 0) return freezePlan(marks, [], []);

  const rootSet = new Set(naturalCells.filter((index) => effects[index] !== EFFECT_NONE));
  const roots = sortMysteries([...rootSet], effects);
  const triggered = new Uint8Array(types.length);
  const effectCells = new Set();
  for (const index of roots) triggered[index] = 1;
  const queue = [];
  let wave = 1;

  for (const root of roots) {
    if (allMarked(marks)) break;
    effectCells.add(root);
    const sources = wave === 1 ? [root] : indicesWithMark(marks, wave);
    const nextWave = wave + 1;
    let changed = false;
    for (const source of sources) changed = applyEffect(effects[root], source, types, effects, size, marks, nextWave, triggered, rootSet, queue, effectCells) || changed;
    if (changed) wave = nextWave;
  }

  while (queue.length && !allMarked(marks)) {
    queue.sort((left, right) => effectRank(effects[left]) - effectRank(effects[right]) || left - right);
    const source = queue.shift();
    applyEffect(effects[source], source, types, effects, size, marks, wave + 1, triggered, rootSet, queue, effectCells);
    wave = maxMark(marks);
  }
  return freezePlan(marks, [...triggered].flatMap((value, index) => value ? [index] : []), [...effectCells].sort((a, b) => a - b));
}

export function collapseAndFill(types, effects, size, generateCell) {
  validateBoard(types, size);
  const nextTypes = Int16Array.from(types);
  const nextEffects = Uint8Array.from(effects);
  const motions = [];
  for (let column = 0; column < size; column += 1) {
    let writeRow = size - 1;
    for (let readRow = size - 1; readRow >= 0; readRow -= 1) {
      const from = readRow * size + column;
      if (nextTypes[from] === EMPTY) continue;
      const to = writeRow * size + column;
      nextTypes[to] = nextTypes[from]; nextEffects[to] = nextEffects[from];
      motions.push(Object.freeze({ fromIndex: from, toIndex: to, type: nextTypes[to], effect: nextEffects[to] }));
      writeRow -= 1;
    }
    const generatedCount = writeRow + 1;
    while (writeRow >= 0) {
      const cell = generateCell();
      const to = writeRow * size + column;
      nextTypes[to] = cell.type; nextEffects[to] = cell.effect;
      motions.push(Object.freeze({ fromIndex: (writeRow - generatedCount) * size + column, toIndex: to, type: cell.type, effect: cell.effect, generated: true }));
      writeRow -= 1;
    }
  }
  return Object.freeze({ types: freezeArray(nextTypes), effects: freezeArray(nextEffects), motions: Object.freeze(motions) });
}

export function areAdjacentIndices(first, second, size) {
  if (!isIndex(first, size ** 2) || !isIndex(second, size ** 2)) return false;
  return Math.abs(first - second) === size ||
    (Math.floor(first / size) === Math.floor(second / size) && Math.abs(first - second) === 1);
}

function applyEffect(effect, source, types, effects, size, marks, wave, triggered, rootSet, queue, effectCells) {
  const targets = affectedIndices(effect, source, types, size);
  for (const index of targets) effectCells.add(index);
  let changed = false;
  for (const index of targets) {
    if (marks[index] !== 0) continue;
    marks[index] = wave;
    changed = true;
    if (effects[index] !== EFFECT_NONE && !triggered[index] && !rootSet.has(index)) {
      triggered[index] = 1;
      queue.push(index);
    }
  }
  return changed;
}

function affectedIndices(effect, source, types, size) {
  const row = Math.floor(source / size), column = source % size;
  if (effect === EFFECT_A) {
    const result = [];
    for (let y = Math.max(0, row - 1); y <= Math.min(size - 1, row + 1); y += 1)
      for (let x = Math.max(0, column - 1); x <= Math.min(size - 1, column + 1); x += 1) result.push(y * size + x);
    return result;
  }
  if (effect === EFFECT_B) return Array.from({ length: size }, (_, x) => row * size + x);
  if (effect === EFFECT_C) return Array.from({ length: size }, (_, y) => y * size + column);
  if (effect === EFFECT_D) return Array.from(types, (type, index) => type === types[source] ? index : -1).filter((index) => index >= 0);
  return [];
}

function sortMysteries(indices, effects) { return indices.sort((a, b) => effectRank(effects[a]) - effectRank(effects[b]) || a - b); }
function effectRank(effect) { const rank = EFFECT_PRIORITY.indexOf(effect); return rank < 0 ? EFFECT_PRIORITY.length : rank; }
function indicesWithMark(marks, wave) { return Array.from(marks, (value, index) => value === wave ? index : -1).filter((index) => index >= 0); }
function maxMark(marks) { let value = 1; for (const mark of marks) value = Math.max(value, mark); return value; }
function allMarked(marks) { for (const mark of marks) if (mark === 0) return false; return true; }
function freezePlan(marks, triggered, effectCells) { return Object.freeze({ marks: Object.freeze(Array.from(marks)), cells: Object.freeze(indicesWithNonzero(marks)), triggered: Object.freeze(triggered), effectCells: Object.freeze(effectCells), count: indicesWithNonzero(marks).length }); }
function indicesWithNonzero(values) { return Array.from(values, (value, index) => value ? index : -1).filter((index) => index >= 0); }
function freezeArray(values) { return Object.freeze(Array.from(values)); }
function swap(board, first, second) { [board[first], board[second]] = [board[second], board[first]]; }
function isIndex(value, length) { return Number.isSafeInteger(value) && value >= 0 && value < length; }
function validateBoard(board, size) { if (!Number.isSafeInteger(size) || size < 3 || board.length !== size ** 2) throw new RangeError("invalid square board"); }
function scanLine(board, marked, offset, step, length) {
  let start = 0;
  while (start < length) {
    const value = board[offset + start * step];
    let end = start + 1;
    while (end < length && value !== EMPTY && board[offset + end * step] === value) end += 1;
    if (value !== EMPTY && end - start >= 3) for (let cursor = start; cursor < end; cursor += 1) marked[offset + cursor * step] = 1;
    start = end;
  }
}
