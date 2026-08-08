import { SCORE_MAX } from "../common/protocol-constants.js";
import { createGameTime, DEADLINE_SETTLEMENT_MS } from "../common/game-time.js";
import { createLogicRng } from "../common/rng.js";
import { createEnergy } from "./energy.js";
import { hasAnyMove, placeShape, validateBoard, validateLineFitConfig } from "./engine.js";

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
const TYPE_FINISH_SETTLEMENT = "FinishSettlement";
const UINT32_RANGE = 0x1_0000_0000;

export function createLineFitRuntime({
  cfg,
  shapes,
  seed,
  limitMS,
  checkpoint = null,
  readBN = () => performance.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
  onSnapshot,
  onPump,
  onError,
}) {
  validateLineFitConfig(cfg, shapes);
  if (!(seed instanceof Uint8Array) || seed.length !== 6) throw new TypeError("seed must be a 6-byte Uint8Array");
  const unlimited = limitMS === null;
  if (!unlimited && (!Number.isSafeInteger(limitMS) || limitMS <= 0)) throw new RangeError("limitMS must be null or a positive safe integer");
  if (checkpoint !== null && !unlimited) throw new TypeError("Only unlimited LineFit games can restore checkpoints");
  const restored = checkpoint === null ? null : normalizeCheckpoint(checkpoint, cfg, shapes);
  const gameTime = createGameTime(limitMS);

  const rng = createLogicRng(seed, restored?.rngState ?? null);
  const eng = createEnergy(cfg, restored?.energy ?? null);
  let phase = PHASE_INIT;
  let operation = OPERATION_IDLE;
  let board = restored?.board ?? Object.freeze(Array(cfg.BoardSize ** 2).fill(0));
  let tray = restored?.tray ?? drawBatch(cfg, shapes, rng);
  let score = restored?.score ?? 0;
  let placementCount = restored?.placementCount ?? 0;
  let clearedLineCount = restored?.clearedLineCount ?? 0;
  let transition = null;
  let lastPlacement = null;
  let endReason = null;
  let endedGT = null;
  let settling = false;
  let nextSequence = 0;
  let destroyed = false;
  let pumping = false;
  let pumpTimer = null;
  let pumpDueBN = null;
  let latestSnapshot = null;
  let latestCheckpoint = restored === null ? null : freezeCheckpoint(restored.runGT, board, tray, score, placementCount, clearedLineCount, eng.exportCheckpoint(), rng.exportState());
  let checkpointRevision = restored === null ? 0 : 1;
  const iQ = [];

  if (restored === null) phase = PHASE_READY;
  else {
    const anchorBN = readBN();
    gameTime.reset(anchorBN - restored.runGT);
    gameTime.pause(anchorBN);
    phase = PHASE_PAUSED;
  }
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
      const deadlineBN = gameTime.getDeadlineBN();
      if (phase === PHASE_RUNNING && settling) drainQueue(tickBN, tickBN);
      else if (phase === PHASE_RUNNING && deadlineBN !== null && tickBN >= deadlineBN) runDeadline(tickBN);
      else drainQueue(tickBN, tickBN);
      publishSnapshot(tickBN);
      if (phase === PHASE_RUNNING) onPump?.(readBN());
    } finally {
      pumping = false;
    }
    if (iQ.length > 0 || phase === PHASE_PREPARING || phase === PHASE_RUNNING) schedulePump();
  }

  function runDeadline(tickBN) {
    const deadlineBN = gameTime.getDeadlineBN();
    if (deadlineBN === null) throw new Error("LineFit deadline is unavailable");
    drainQueue(deadlineBN, tickBN);
    if (phase === PHASE_RUNNING) {
      eng.advanceTo(limitMS);
      operation = OPERATION_IDLE;
      transition = null;
      removeQueued(TYPE_FINISH_CLEAR);
      beginSettlement(tickBN);
    }
  }

  function drainQueue(upToBN, tickBN) {
    while (iQ.length && iQ[0].BN < upToBN) {
      const item = iQ.shift();
      handleItem(item, tickBN);
      if (phase === PHASE_ENDED || phase === PHASE_ERROR) return;
    }
  }

  function handleItem(item, tickBN) {
    if (item.type === TYPE_GAME_BAR_CLICK) {
      if (phase === PHASE_READY || phase === PHASE_PAUSED) beginPreparing(tickBN);
      else if (phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
      else if (phase === PHASE_RUNNING) pauseAt(item.BN);
      return;
    }
    if (item.type === TYPE_PAUSE_GAME) {
      if (phase === PHASE_PREPARING) {
        removeQueued(TYPE_START_GAME);
        phase = PHASE_PAUSED;
      } else if (phase === PHASE_RUNNING && settling) {
        end("TIME_UP", limitMS);
      } else if (phase === PHASE_RUNNING) {
        pauseAt(item.BN);
      }
      return;
    }
    if (item.type === TYPE_START_GAME) {
      if (phase !== PHASE_PREPARING) return;
      phase = PHASE_RUNNING;
      publishSnapshot(tickBN);
      const startBN = readBN();
      if (gameTime.getGT(startBN) === null) gameTime.reset(startBN);
      else gameTime.resume(startBN);
      return;
    }
    if (item.type === TYPE_FINISH_SETTLEMENT) {
      if (phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
      return;
    }
    if (item.type === TYPE_FINISH_CLEAR) {
      if (phase !== PHASE_RUNNING || operation !== OPERATION_CLEARING || item.data?.endGT !== transition?.endGT) return;
      eng.advanceTo(item.data.endGT);
      operation = OPERATION_IDLE;
      transition = null;
      captureCheckpoint(item.data.endGT);
      return;
    }
    if (item.type === TYPE_PLAYER_ACTION) handleAction(item);
  }

  function handleAction(item) {
    if (phase !== PHASE_RUNNING || settling || operation !== OPERATION_IDLE) return;
    const actionGT = gameTime.getGT(item.BN);
    if (actionGT === null || actionGT < 0 || (!unlimited && actionGT > limitMS)) return;
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
    lastPlacement = Object.freeze({ count: placementCount, actionGT, clearCount: result.clearCount });

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
    } else captureCheckpoint(actionGT);
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
      const settledGT = unlimited ? transition.endGT : Math.min(transition.endGT, limitMS);
      eng.advanceTo(settledGT);
      gameTime.pauseAndJumpTo(BN, settledGT);
      removeQueued(TYPE_FINISH_CLEAR);
      operation = OPERATION_IDLE;
      transition = null;
      captureCheckpoint(settledGT);
    } else {
      eng.advanceTo(pauseGT);
      gameTime.pause(BN);
      captureCheckpoint(pauseGT);
    }
    phase = PHASE_PAUSED;
  }

  function end(reason, atGT) {
    phase = PHASE_ENDED;
    settling = false;
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
    const runGT = phase === PHASE_ENDED || settling ? endedGT : Math.max(0, sampledGT ?? 0);
    if (phase === PHASE_RUNNING) eng.advanceTo(unlimited ? runGT : Math.min(runGT, limitMS));
    const energySnapshot = eng.snapshot();
    latestSnapshot = Object.freeze({
      phase,
      operation,
      runGT,
      remainingMS: unlimited ? null : Math.max(0, limitMS - runGT),
      prepareRemainingMS,
      board,
      tray,
      score,
      energy: energySnapshot.energy,
      scoreMultiplier: energySnapshot.multiplier,
      placementCount,
      clearedLineCount,
      transition,
      lastPlacement,
      endReason,
      endedGT,
      settling,
      checkpoint: latestCheckpoint,
      checkpointRevision,
      result: phase === PHASE_ENDED ? Object.freeze({ score, reason: endReason }) : null,
    });
    onSnapshot?.(latestSnapshot);
  }

  function beginSettlement(tickBN) {
    settling = true;
    endReason = "TIME_UP";
    endedGT = limitMS;
    iQ.length = 0;
    insertInternal(TYPE_FINISH_SETTLEMENT, tickBN + DEADLINE_SETTLEMENT_MS);
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

  function captureCheckpoint(runGT) {
    if (!unlimited || !Number.isFinite(runGT) || runGT < 0) return;
    latestCheckpoint = freezeCheckpoint(runGT, board, tray, score, placementCount, clearedLineCount, eng.exportCheckpoint(), rng.exportState());
    checkpointRevision += 1;
  }

  function runSafely(operationFn) {
    if (destroyed || phase === PHASE_ERROR) return;
    try {
      operationFn();
    } catch (error) {
      phase = PHASE_ERROR;
      settling = false;
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
      return !destroyed && ((pumpDueBN !== null && BN >= pumpDueBN) || (iQ[0]?.BN ?? Infinity) < BN);
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

function freezeCheckpoint(runGT, board, tray, score, placementCount, clearedLineCount, energy, rngState) {
  return Object.freeze({ version: 1, runGT, board, tray, score, placementCount, clearedLineCount, energy, rngState });
}

function normalizeCheckpoint(value, cfg, shapes) {
  if (!value || typeof value !== "object" || value.version !== 1 || !Number.isFinite(value.runGT) || value.runGT < 0) throw new TypeError("Invalid LineFit checkpoint");
  const board = Object.freeze(Array.isArray(value.board) ? [...value.board] : []);
  validateBoard(board, cfg.BoardSize);
  if (!Array.isArray(value.tray) || value.tray.length !== cfg.TraySize) throw new TypeError("Invalid LineFit checkpoint tray");
  const tray = Object.freeze(value.tray.map((shapeIndex) => {
    if (shapeIndex === null) return null;
    if (!Number.isSafeInteger(shapeIndex) || !shapes[shapeIndex]) throw new TypeError("Invalid LineFit checkpoint tray");
    return shapeIndex;
  }));
  for (const field of ["score", "placementCount", "clearedLineCount"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw new TypeError(`Invalid LineFit checkpoint ${field}`);
  }
  if (value.score > SCORE_MAX || value.clearedLineCount > value.placementCount * cfg.BoardSize * 2) throw new TypeError("Invalid LineFit checkpoint counters");
  if (!value.energy || value.energy.version !== 1 || !Number.isSafeInteger(value.energy.energy) || value.energy.energy < 0 || !Number.isFinite(value.energy.settledGT) || value.energy.settledGT < 0 || value.energy.settledGT > value.runGT) throw new TypeError("Invalid LineFit checkpoint energy");
  const energy = Object.freeze({ version: 1, energy: value.energy.energy, settledGT: value.energy.settledGT });
  if (typeof value.rngState !== "string" || !/^[0-9a-f]{16}$/i.test(value.rngState)) throw new TypeError("Invalid LineFit checkpoint RNG state");
  if (!hasAnyMove(board, cfg.BoardSize, tray, shapes)) throw new TypeError("Invalid ended LineFit checkpoint");
  return Object.freeze({
    runGT: value.runGT,
    board,
    tray,
    score: value.score,
    placementCount: value.placementCount,
    clearedLineCount: value.clearedLineCount,
    energy,
    rngState: value.rngState.toLowerCase(),
  });
}
