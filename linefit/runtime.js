import { SCORE_MAX } from "../common/protocol-constants.js";
import { createLogicRng } from "../common/rng.js";
import { createEnergy } from "./energy.js";
import { hasAnyMove, placeShape, validateLineFitConfig } from "./engine.js";

export const PHASE_INIT = "PHASE_INIT";
export const PHASE_READY = "PHASE_READY";
export const PHASE_PREPARING = "PHASE_PREPARING";
export const PHASE_RUNNING = "PHASE_RUNNING";
export const PHASE_PAUSED = "PHASE_PAUSED";
export const PHASE_ENDED = "PHASE_ENDED";
export const PHASE_ERROR = "PHASE_ERROR";

export const OPERATION_IDLE = "IDLE";
export const OPERATION_CLEARING = "CLEARING";

const TYPE_GAME_BAR_CLICK = "GameBarClick";
const TYPE_PAUSE_GAME = "PauseGame";
const TYPE_START_GAME = "StartGame";
const TYPE_PLAYER_ACTION = "PAction";
const TYPE_FINISH_CLEAR = "FinishClear";
const UINT32_RANGE = 0x1_0000_0000;

export function createGameTime() {
  let startAt = null;
  let pauseAt = null;
  let limitGT = null;

  return Object.freeze({
    reset(baseNow) {
      startAt = baseNow;
      pauseAt = null;
    },
    pause(baseNow) {
      if (startAt === null || pauseAt !== null) return;
      pauseAt = baseNow;
    },
    pauseAndJumpTo(baseNow, targetGT) {
      if (startAt === null || pauseAt !== null) return;
      const currentGT = baseNow - startAt;
      const jumpGT = Number.isFinite(targetGT) ? Math.max(0, targetGT - currentGT) : 0;
      pauseAt = baseNow;
      startAt -= jumpGT;
    },
    resume(baseNow) {
      if (startAt === null || pauseAt === null) return;
      startAt += baseNow - pauseAt;
      pauseAt = null;
    },
    getGT(baseNow) {
      if (startAt === null) return null;
      return (pauseAt ?? baseNow) - startAt;
    },
    getBN(gameTime) {
      if (startAt === null || pauseAt !== null || !Number.isFinite(gameTime)) return null;
      return startAt + gameTime;
    },
    setLimit(limitMS) {
      if (!Number.isFinite(limitMS) || limitMS < 0) {
        limitGT = null;
        return false;
      }
      limitGT = limitMS;
      return true;
    },
    isTimeUp(baseNow) {
      if (limitGT === null) return false;
      const currentGT = this.getGT(baseNow);
      return currentGT !== null && currentGT >= limitGT;
    },
  });
}

export function createLineFitRuntime({
  cfg,
  shapes,
  seed,
  limitMS,
  readBN = () => performance.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
  onSnapshot,
  onPump,
  onError,
}) {
  validateLineFitConfig(cfg, shapes);
  if (!(seed instanceof Uint8Array) || seed.length !== 6) throw new TypeError("seed must be a 6-byte Uint8Array");
  const gameTime = createGameTime();
  if (!gameTime.setLimit(limitMS)) throw new RangeError("limitMS must be nonnegative");

  const rng = createLogicRng(seed);
  const eng = createEnergy(cfg);
  let phase = PHASE_INIT;
  let operation = OPERATION_IDLE;
  let board = Object.freeze(Array(cfg.BoardSize ** 2).fill(0));
  let tray = drawBatch(cfg, shapes, rng);
  let score = 0;
  let placementCount = 0;
  let clearedLineCount = 0;
  let transition = null;
  let endReason = null;
  let endedGT = null;
  let nextSequence = 0;
  let destroyed = false;
  let pumping = false;
  let pumpTimer = null;
  let pumpDueBN = null;
  let latestSnapshot = null;
  const iQ = [];

  phase = PHASE_READY;
  publishSnapshot(readBN());

  function enqueue(type, BN, data = null) {
    if (destroyed || phase === PHASE_ENDED || phase === PHASE_ERROR) return false;
    if (!Number.isFinite(BN)) throw new TypeError("BN must be finite");
    const frozenData = data && typeof data === "object" ? Object.freeze({ ...data }) : data;
    insertItem(Object.freeze({ BN, sequence: nextSequence++, type, data: frozenData }));
    wakePump();
    return true;
  }

  function insertInternal(type, BN, data = null) {
    const frozenData = data && typeof data === "object" ? Object.freeze({ ...data }) : data;
    insertItem(Object.freeze({ BN, sequence: nextSequence++, type, data: frozenData }));
  }

  function insertItem(item) {
    let index = iQ.length;
    while (index > 0 && compareItems(item, iQ[index - 1]) < 0) index -= 1;
    iQ.splice(index, 0, item);
  }

  function wakePump() {
    if (destroyed || pumping) return;
    if (pumpTimer !== null) clearTimer(pumpTimer);
    pumpTimer = null;
    pumpDueBN = null;
    runSafely(pump);
  }

  function pump() {
    if (destroyed || pumping) return;
    pumpTimer = null;
    pumpDueBN = null;
    pumping = true;
    try {
      const tickBN = readBN();
      if (phase === PHASE_RUNNING && gameTime.isTimeUp(tickBN)) runDeadline(tickBN);
      else drainQueue(tickBN, tickBN);
      publishSnapshot(tickBN);
      if (phase === PHASE_RUNNING) onPump?.(readBN());
    } finally {
      pumping = false;
    }
    if (phase === PHASE_PREPARING || phase === PHASE_RUNNING) schedulePump();
  }

  function runDeadline(tickBN) {
    const deadlineBN = gameTime.getBN(limitMS);
    if (deadlineBN === null) throw new Error("LineFit deadline is unavailable");
    drainQueue(deadlineBN, tickBN);
    if (phase === PHASE_RUNNING) {
      eng.advanceTo(limitMS);
      end("TIME_UP", limitMS);
    }
  }

  function drainQueue(upToBN, tickBN) {
    while (iQ.length && iQ[0].BN <= upToBN) {
      const item = iQ.shift();
      handleItem(item, tickBN);
      if (phase === PHASE_ENDED || phase === PHASE_ERROR) return;
    }
  }

  function handleItem(item, tickBN) {
    if (item.type === TYPE_GAME_BAR_CLICK) {
      if (phase === PHASE_READY || phase === PHASE_PAUSED) beginPreparing(tickBN);
      else if (phase === PHASE_RUNNING) pauseAt(item.BN);
      return;
    }
    if (item.type === TYPE_PAUSE_GAME) {
      if (phase === PHASE_PREPARING) {
        removeQueued(TYPE_START_GAME);
        phase = PHASE_PAUSED;
      } else if (phase === PHASE_RUNNING) {
        pauseAt(item.BN);
      }
      return;
    }
    if (item.type === TYPE_START_GAME) {
      if (phase !== PHASE_PREPARING) return;
      if (gameTime.getGT(tickBN) === null) gameTime.reset(tickBN);
      else gameTime.resume(tickBN);
      phase = PHASE_RUNNING;
      return;
    }
    if (item.type === TYPE_FINISH_CLEAR) {
      if (phase !== PHASE_RUNNING || operation !== OPERATION_CLEARING || item.data?.endGT !== transition?.endGT) return;
      operation = OPERATION_IDLE;
      transition = null;
      return;
    }
    if (item.type === TYPE_PLAYER_ACTION) handleAction(item);
  }

  function handleAction(item) {
    if (phase !== PHASE_RUNNING || operation !== OPERATION_IDLE) return;
    const actionGT = gameTime.getGT(item.BN);
    if (actionGT === null || actionGT < 0 || actionGT > limitMS) return;
    const trayIndex = item.data?.trayIndex;
    const row = item.data?.row;
    const column = item.data?.column;
    if (!Number.isSafeInteger(trayIndex) || trayIndex < 0 || trayIndex >= tray.length ||
      !Number.isSafeInteger(row) || !Number.isSafeInteger(column)) return;
    const shapeIndex = tray[trayIndex];
    if (!Number.isSafeInteger(shapeIndex) || !shapes[shapeIndex]) return;

    eng.advanceTo(actionGT);
    const result = placeShape(board, cfg.BoardSize, shapes[shapeIndex], row, column, cfg);
    if (!result) return;

    const nextTray = [...tray];
    nextTray[trayIndex] = null;
    tray = Object.freeze(nextTray);
    board = result.board;
    eng.charge(result.cellCount * cfg.EnergyPerCell);
    const scoreDelta = eng.applyScore(result.rawScore);
    score = Math.min(SCORE_MAX, score + scoreDelta);
    placementCount += 1;
    clearedLineCount += result.clearCount;

    if (tray.every((value) => value === null)) tray = drawBatch(cfg, shapes, rng);
    if (!hasAnyMove(board, cfg.BoardSize, tray, shapes)) {
      end("NO_MOVES", actionGT);
      return;
    }

    if (result.clearCount > 0) {
      const endGT = actionGT + cfg.ClearMS;
      operation = OPERATION_CLEARING;
      transition = Object.freeze({
        startGT: actionGT,
        endGT,
        placedBoard: result.placedBoard,
        placedIndexes: result.placedIndexes,
        clearedIndexes: result.clearedIndexes,
        clearCount: result.clearCount,
        scoreDelta,
      });
      const finishBN = gameTime.getBN(endGT);
      if (finishBN === null) throw new Error("LineFit clear boundary is unavailable");
      insertInternal(TYPE_FINISH_CLEAR, finishBN, { endGT });
    }
  }

  function beginPreparing(tickBN) {
    removeQueued(TYPE_START_GAME);
    phase = PHASE_PREPARING;
    insertInternal(TYPE_START_GAME, tickBN + cfg.PrepareMS);
  }

  function pauseAt(BN) {
    const pauseGT = gameTime.getGT(BN);
    if (pauseGT === null || pauseGT < 0) return;
    if (operation === OPERATION_CLEARING && transition !== null) {
      const settledGT = Math.min(transition.endGT, limitMS);
      eng.advanceTo(settledGT);
      gameTime.pauseAndJumpTo(BN, settledGT);
      removeQueued(TYPE_FINISH_CLEAR);
      operation = OPERATION_IDLE;
      transition = null;
    } else {
      eng.advanceTo(pauseGT);
      gameTime.pause(BN);
    }
    phase = PHASE_PAUSED;
  }

  function end(reason, atGT) {
    phase = PHASE_ENDED;
    operation = OPERATION_IDLE;
    transition = null;
    endReason = reason;
    endedGT = atGT;
    iQ.length = 0;
    if (pumpTimer !== null) clearTimer(pumpTimer);
    pumpTimer = null;
    pumpDueBN = null;
  }

  function publishSnapshot(sampleBN) {
    const prepareAt = iQ.find((item) => item.type === TYPE_START_GAME)?.BN ?? null;
    const prepareRemainingMS = phase === PHASE_PREPARING && prepareAt !== null ? Math.max(0, prepareAt - sampleBN) : 0;
    const sampledGT = gameTime.getGT(sampleBN);
    const runGT = phase === PHASE_ENDED ? endedGT : Math.max(0, sampledGT ?? 0);
    if (phase === PHASE_RUNNING) eng.advanceTo(Math.min(runGT, limitMS));
    const energySnapshot = eng.snapshot();
    latestSnapshot = Object.freeze({
      phase,
      operation,
      runGT,
      remainingMS: Math.max(0, limitMS - runGT),
      prepareRemainingMS,
      board,
      tray,
      score,
      energy: energySnapshot.energy,
      scoreMultiplier: energySnapshot.multiplier,
      placementCount,
      clearedLineCount,
      transition,
      endReason,
      endedGT,
      result: phase === PHASE_ENDED ? Object.freeze({ score, reason: endReason }) : null,
    });
    onSnapshot?.(latestSnapshot);
  }

  function schedulePump() {
    if (destroyed || pumpTimer !== null) return;
    pumpDueBN = readBN() + cfg.PumpWaitMS;
    pumpTimer = setTimer(() => runSafely(pump), cfg.PumpWaitMS);
  }

  function removeQueued(type) {
    for (let index = iQ.length - 1; index >= 0; index -= 1) {
      if (iQ[index].type === type) iQ.splice(index, 1);
    }
  }

  function runSafely(operationFn) {
    if (destroyed || phase === PHASE_ERROR) return;
    try {
      operationFn();
    } catch (error) {
      phase = PHASE_ERROR;
      operation = OPERATION_IDLE;
      transition = null;
      if (pumpTimer !== null) clearTimer(pumpTimer);
      pumpTimer = null;
      pumpDueBN = null;
      iQ.length = 0;
      publishSnapshot(readBN());
      onError?.(error);
    }
  }

  return Object.freeze({
    snapshot: () => latestSnapshot,
    enqueueGameBarClick: (BN = readBN()) => enqueue(TYPE_GAME_BAR_CLICK, BN),
    enqueuePause: (BN = readBN()) => enqueue(TYPE_PAUSE_GAME, BN),
    enqueueAction(trayIndex, row, column, BN = readBN()) {
      for (const value of [trayIndex, row, column]) {
        if (!Number.isSafeInteger(value)) throw new RangeError("LineFit action coordinates must be safe integers");
      }
      return enqueue(TYPE_PLAYER_ACTION, BN, { trayIndex, row, column });
    },
    shouldYieldRender(BN = readBN()) {
      return !destroyed && ((pumpDueBN !== null && BN >= pumpDueBN) || (iQ[0]?.BN ?? Infinity) <= BN);
    },
    wakePump,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (pumpTimer !== null) clearTimer(pumpTimer);
      pumpTimer = null;
      pumpDueBN = null;
      iQ.length = 0;
    },
  });
}

export function nextBounded(rng, bound) {
  if (!Number.isSafeInteger(bound) || bound <= 0 || bound > UINT32_RANGE) {
    throw new RangeError("bound must be an integer from 1 to 2^32");
  }
  const limit = Math.floor(UINT32_RANGE / bound) * bound;
  let value;
  do value = rng.nextUint32(); while (value >= limit);
  return value % bound;
}

function drawBatch(cfg, shapes, rng) {
  return Object.freeze(Array.from({ length: cfg.TraySize }, () => nextBounded(rng, shapes.length)));
}

function compareItems(left, right) {
  return left.BN - right.BN || left.sequence - right.sequence;
}
