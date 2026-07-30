import { createLogicRng } from "../common/rng.js";
import { MATCH3_BOARD_CFG, MATCH3_SCORE_CFG } from "./config.js";

const EMPTY = -1;

export function createMatch3Engine(seed, limitMs) {
  if (!Number.isSafeInteger(limitMs) || limitMs <= 0) throw new RangeError("limitMs must be a positive safe integer");
  const { width, height, colorCount, bagCopiesPerColor } = MATCH3_BOARD_CFG;
  const rng = createLogicRng(seed);
  const board = new Int8Array(width * height);
  const refilled = new Uint8Array(width * height);
  let bag = [];
  let bagIndex = 0;
  let score = 0;
  let initialized = false;

  function randomBelow(bound) {
    const range = 0x1_0000_0000;
    const limit = Math.floor(range / bound) * bound;
    let value;
    do value = rng.nextUint32(); while (value >= limit);
    return value % bound;
  }

  function refillBag() {
    bag = [];
    for (let color = 0; color < colorCount; color += 1) {
      for (let count = 0; count < bagCopiesPerColor; count += 1) bag.push(color);
    }
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const other = randomBelow(index + 1);
      [bag[index], bag[other]] = [bag[other], bag[index]];
    }
    bagIndex = 0;
  }

  function nextColor() {
    if (bagIndex >= bag.length) refillBag();
    return bag[bagIndex++];
  }

  for (let index = 0; index < board.length; index += 1) board[index] = nextColor();

  function initialize() {
    if (initialized) return { initialized: false, steps: [], snapshot: getSnapshot() };
    initialized = true;
    const steps = [];
    resolveMatches(steps, true);
    return { initialized: true, steps, snapshot: getSnapshot() };
  }

  function resolveMatches(steps, opening = false) {
    refilled.fill(0);
    let layer = 1;
    let matches = findMatches(board, width, height);
    while (matches.length) {
      const cascadeDepth = layer - 1;
      const hasFill = opening || matches.some((index) => refilled[index] === 1);
      const scoreMultiplier = opening
        ? layer
        : cascadeDepth === 0
          ? 1
          : cascadeDepth * (hasFill ? 1 : MATCH3_SCORE_CFG.noFillChainMultiplier);
      const rawPoints = calculateMatch3Points(matches.length, scoreMultiplier);
      const points = Math.min(rawPoints, MATCH3_SCORE_CFG.maxScore - score);
      score += points;
      for (const index of matches) {
        board[index] = EMPTY;
        refilled[index] = 0;
      }
      steps?.push({
        kind: "clear",
        cells: matches,
        board: Array.from(board),
        chain: layer,
        cascadeDepth,
        hasFill,
        scoreMultiplier,
        points,
      });
      collapseAndFill();
      steps?.push({ kind: "fall", board: Array.from(board), chain: layer });
      layer += 1;
      matches = findMatches(board, width, height);
    }
  }

  function collapseAndFill() {
    for (let x = 0; x < width; x += 1) {
      let writeY = height - 1;
      for (let readY = height - 1; readY >= 0; readY -= 1) {
        const value = board[readY * width + x];
        if (value === EMPTY) continue;
        board[writeY * width + x] = value;
        refilled[writeY * width + x] = refilled[readY * width + x];
        writeY -= 1;
      }
      while (writeY >= 0) {
        board[writeY * width + x] = nextColor();
        refilled[writeY * width + x] = 1;
        writeY -= 1;
      }
    }
  }

  function applySwap(from, to, remainMs) {
    if (!initialized) return { accepted: false, steps: [], snapshot: getSnapshot() };
    if (!isCell(from, width, height) || !isCell(to, width, height) || !areAdjacent(from, to)) {
      return { accepted: false, steps: [], snapshot: getSnapshot() };
    }
    if (!Number.isSafeInteger(remainMs) || remainMs <= 0 || remainMs > limitMs) {
      return { accepted: false, steps: [], snapshot: getSnapshot() };
    }

    const fromIndex = from.y * width + from.x;
    const toIndex = to.y * width + to.x;
    [board[fromIndex], board[toIndex]] = [board[toIndex], board[fromIndex]];
    const steps = [{ kind: "swap", from, to, board: Array.from(board) }];
    if (!findMatches(board, width, height).length) {
      [board[fromIndex], board[toIndex]] = [board[toIndex], board[fromIndex]];
      steps.push({ kind: "swapBack", from: to, to: from, board: Array.from(board) });
      return { accepted: true, steps, snapshot: getSnapshot() };
    }

    resolveMatches(steps);
    return { accepted: true, steps, snapshot: getSnapshot() };
  }

  function hasLegalMove() {
    return initialized && boardHasLegalMove(board, width, height);
  }

  function getSnapshot() {
    return Object.freeze({ board: Object.freeze(Array.from(board)), score, width, height });
  }

  return Object.freeze({ initialize, applySwap, getSnapshot, hasLegalMove });
}

export function calculateMatch3Points(clearCount, multiplier = 1) {
  if (!Number.isSafeInteger(clearCount) || clearCount < 3) {
    throw new RangeError("clearCount must be an integer of at least 3");
  }
  if (!Number.isSafeInteger(multiplier) || multiplier < 1) {
    throw new RangeError("multiplier must be a positive safe integer");
  }

  let clearScore = MATCH3_SCORE_CFG.clearScoreBase;
  for (let count = 3; count < clearCount && clearScore < MATCH3_SCORE_CFG.maxScore; count += 1) {
    clearScore = Math.min(MATCH3_SCORE_CFG.maxScore, clearScore * 2);
  }
  if (clearScore >= Math.ceil(MATCH3_SCORE_CFG.maxScore / multiplier)) {
    return MATCH3_SCORE_CFG.maxScore;
  }
  return clearScore * multiplier;
}

export function findMatches(board, width, height) {
  const matched = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    let start = 0;
    while (start < width) {
      const color = board[y * width + start];
      let end = start + 1;
      while (end < width && color !== EMPTY && board[y * width + end] === color) end += 1;
      if (color !== EMPTY && end - start >= 3) {
        for (let x = start; x < end; x += 1) matched[y * width + x] = 1;
      }
      start = end;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let start = 0;
    while (start < height) {
      const color = board[start * width + x];
      let end = start + 1;
      while (end < height && color !== EMPTY && board[end * width + x] === color) end += 1;
      if (color !== EMPTY && end - start >= 3) {
        for (let y = start; y < end; y += 1) matched[y * width + x] = 1;
      }
      start = end;
    }
  }
  return Array.from(matched, (value, index) => value ? index : -1).filter((index) => index >= 0);
}

export function boardHasLegalMove(board, width, height) {
  const copy = Int8Array.from(board);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX >= width || nextY >= height) continue;
        const nextIndex = nextY * width + nextX;
        [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
        const valid = findMatches(copy, width, height).length > 0;
        [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
        if (valid) return true;
      }
    }
  }
  return false;
}

function isCell(cell, width, height) {
  return cell && Number.isInteger(cell.x) && Number.isInteger(cell.y) && cell.x >= 0 && cell.x < width && cell.y >= 0 && cell.y < height;
}

function areAdjacent(first, second) {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y) === 1;
}
