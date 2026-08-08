import { SCORE_MAX } from "../common/protocol-constants.js";
import { createGameTime, DEADLINE_SETTLEMENT_MS } from "../common/game-time.js";
import { createLogicRng } from "../common/rng.js";
import { canMove, getMaxTile, moveBoard, validate2048Config, validateBoard } from "./engine.js";

export const PHASE_INIT = "PHASE_INIT";
export const PHASE_READY = "PHASE_READY";
export const PHASE_PREPARING = "PHASE_PREPARING";
export const PHASE_RUNNING = "PHASE_RUNNING";
export const PHASE_PAUSED = "PHASE_PAUSED";
export const PHASE_ENDED = "PHASE_ENDED";
export const PHASE_ERROR = "PHASE_ERROR";

export const OPERATION_IDLE = "IDLE";
export const OPERATION_MOVING = "MOVING";

const TYPE_GAME_BAR_CLICK = "GameBarClick";
const TYPE_PAUSE_GAME = "PauseGame";
const TYPE_START_GAME = "StartGame";
const TYPE_PLAYER_ACTION = "PAction";
const TYPE_FINISH_MOVE = "FinishMove";
const TYPE_FINISH_SETTLEMENT = "FinishSettlement";
const UINT32_RANGE = 0x1_0000_0000;
const DIRECTIONS = new Set(["north", "east", "south", "west"]);

export function create2048Runtime({
  cfg,
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
  validate2048Config(cfg);
  if (!(seed instanceof Uint8Array) || seed.length !== 6) throw new TypeError("seed must be a 6-byte Uint8Array");
  const unlimited = limitMS === null;
  if (!unlimited && (!Number.isSafeInteger(limitMS) || limitMS <= 0)) throw new RangeError("limitMS must be null or a positive safe integer");
  if (checkpoint !== null && !unlimited) throw new TypeError("Only unlimited 2048 games can restore checkpoints");
  const restored = checkpoint === null ? null : normalizeCheckpoint(checkpoint, cfg);
  const gameTime = createGameTime(limitMS);

  const rng = createLogicRng(seed, restored?.rngState ?? null);
  let phase = PHASE_INIT;
  let operation = OPERATION_IDLE;
  let board = restored?.board ?? Object.freeze(Array(cfg.BoardSize ** 2).fill(0));
  let score = restored?.score ?? 0;
  let energy = restored?.energy ?? cfg.EnergyInitial;
  let energyDecayGT = restored?.energyDecayGT ?? 0;
  let maxTile = restored?.maxTile ?? 0;
  let moveCount = restored?.moveCount ?? 0;
  let transition = null;
  let endReason = null;
  let endedGT = null;
  let settling = false;
  let nextSequence = 0;
  let destroyed = false;
  let pumping = false;
  let pumpTimer = null;
  let pumpDueBN = null;
  let latestSnapshot = null;
  let latestCheckpoint = restored === null ? null : freezeCheckpoint(restored.runGT, board, score, energy, energyDecayGT, maxTile, moveCount, rng.exportState());
  let checkpointRevision = restored === null ? 0 : 1;
  const iQ = [];

  if (restored === null) {
    for (let index = 0; index < cfg.InitialTileCount; index += 1) {
      const generated = spawnTile(board, cfg, rng);
      board = generated.board;
    }
    maxTile = getMaxTile(board);
    phase = PHASE_READY;
  } else {
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
    if (deadlineBN === null) throw new Error("2048 deadline is unavailable");
    drainQueue(deadlineBN, tickBN);
    if (phase === PHASE_RUNNING) {
      settleEnergy(limitMS);
      operation = OPERATION_IDLE;
      transition = null;
      removeQueued(TYPE_FINISH_MOVE);
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
    if (item.type === TYPE_FINISH_MOVE) {
      if (phase !== PHASE_RUNNING || operation !== OPERATION_MOVING || item.data?.endGT !== transition?.endGT) return;
      settleEnergy(item.data.endGT);
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
    settleEnergy(actionGT);
    const moved = moveBoard(board, cfg.BoardSize, item.data.direction);
    if (!moved.changed) return;

    const generated = spawnTile(moved.board, cfg, rng);
    board = generated.board;
    score = saturatingScoreAdd(score, moved.scoreDelta, energy, cfg.ScoreEnergyDivisor);
    energy = saturatingEnergyAdd(energy, getMergeCharge(moved.mergeCount, cfg));
    maxTile = getMaxTile(board);
    moveCount += 1;

    if (!canMove(board, cfg.BoardSize)) {
      end("NO_MOVES", actionGT);
      return;
    }

    const endGT = actionGT + cfg.MoveMS;
    operation = OPERATION_MOVING;
    transition = Object.freeze({
      startGT: actionGT,
      endGT,
      motions: moved.motions,
      mergeCount: moved.mergeCount,
      spawn: generated.spawn,
    });
    const finishBN = gameTime.getBN(endGT);
    if (finishBN === null) throw new Error("2048 move boundary is unavailable");
    insertInternal(TYPE_FINISH_MOVE, finishBN, { endGT });
  }

  function beginPreparing(tickBN) {
    removeQueued(TYPE_START_GAME);
    phase = PHASE_PREPARING;
    insertInternal(TYPE_START_GAME, tickBN + cfg.PrepareMS);
  }

  function pauseAt(BN) {
    const pauseGT = gameTime.getGT(BN);
    if (pauseGT === null || pauseGT < 0) return;
    if (operation === OPERATION_MOVING && transition !== null) {
      const settledGT = unlimited ? transition.endGT : Math.min(transition.endGT, limitMS);
      settleEnergy(settledGT);
      gameTime.pauseAndJumpTo(BN, settledGT);
      removeQueued(TYPE_FINISH_MOVE);
      operation = OPERATION_IDLE;
      transition = null;
      captureCheckpoint(settledGT);
    } else {
      settleEnergy(pauseGT);
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
    if (phase === PHASE_RUNNING) settleEnergy(unlimited ? runGT : Math.min(runGT, limitMS));
    latestSnapshot = Object.freeze({
      phase,
      operation,
      runGT,
      remainingMS: unlimited ? null : Math.max(0, limitMS - runGT),
      prepareRemainingMS,
      board,
      score,
      energy,
      scoreMultiplier: getEnergyMultiplier(energy, cfg),
      maxTile,
      moveCount,
      transition,
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

  function settleEnergy(atGT) {
    if (!Number.isFinite(atGT) || atGT < energyDecayGT) return;
    const decayTicks = Math.floor((atGT - energyDecayGT) / cfg.EnergyDecayMS);
    if (decayTicks <= 0) return;
    energyDecayGT += decayTicks * cfg.EnergyDecayMS;
    energy = Math.max(cfg.EnergyMinimum, energy - decayTicks * cfg.EnergyDecayDelta);
  }

  function removeQueued(type) {
    for (let index = iQ.length - 1; index >= 0; index -= 1) {
      if (iQ[index].type === type) iQ.splice(index, 1);
    }
  }

  function captureCheckpoint(runGT) {
    if (!unlimited || !Number.isFinite(runGT) || runGT < 0) return;
    latestCheckpoint = freezeCheckpoint(runGT, board, score, energy, energyDecayGT, maxTile, moveCount, rng.exportState());
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
    enqueueAction(direction, BN = readBN()) {
      if (!DIRECTIONS.has(direction)) throw new RangeError("direction must be north, east, south, or west");
      return enqueue(TYPE_PLAYER_ACTION, BN, { direction });
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

export function getEnergyMultiplier(energy, cfg) {
  if (!Number.isSafeInteger(energy) || energy < 0) throw new RangeError("energy must be a nonnegative safe integer");
  return energy / cfg.ScoreEnergyDivisor;
}

export function getMergeCharge(mergeCount, cfg) {
  if (!Number.isSafeInteger(mergeCount) || mergeCount < 0) throw new RangeError("mergeCount must be a nonnegative safe integer");
  if (mergeCount === 0) return 0;
  return Math.min(cfg.EnergyChargeMax, cfg.EnergyChargeBase * (2 ** (mergeCount - 1)));
}

function saturatingEnergyAdd(energy, charge) {
  return charge > Number.MAX_SAFE_INTEGER - energy ? Number.MAX_SAFE_INTEGER : energy + charge;
}

function saturatingScoreAdd(score, rawDelta, energy, divisor) {
  const remaining = SCORE_MAX - score;
  if (energy > Math.floor(remaining * divisor / rawDelta)) return SCORE_MAX;
  return score + Math.floor(rawDelta * energy / divisor);
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

function spawnTile(board, cfg, rng) {
  const empty = [];
  for (let index = 0; index < board.length; index += 1) {
    if (board[index] === 0) empty.push(index);
  }
  if (empty.length === 0) throw new Error("2048 cannot spawn on a full board");
  const index = empty[nextBounded(rng, empty.length)];
  const selection = nextBounded(rng, cfg.SpawnTwoWeight + cfg.SpawnFourWeight);
  const value = selection < cfg.SpawnTwoWeight ? 2 : 4;
  const next = [...board];
  next[index] = value;
  return Object.freeze({
    board: Object.freeze(next),
    spawn: Object.freeze({ index, value }),
  });
}

function compareItems(left, right) {
  return left.BN - right.BN || left.sequence - right.sequence;
}

function freezeCheckpoint(runGT, board, score, energy, energyDecayGT, maxTile, moveCount, rngState) {
  return Object.freeze({ version: 2, runGT, board, score, energy, energyDecayGT, maxTile, moveCount, rngState });
}

function normalizeCheckpoint(value, cfg) {
  if (!value || typeof value !== "object" || value.version !== 2 || !Number.isFinite(value.runGT) || value.runGT < 0) throw new TypeError("Invalid 2048 checkpoint");
  const board = Object.freeze(Array.isArray(value.board) ? [...value.board] : []);
  validateBoard(board, cfg.BoardSize);
  for (const field of ["score", "energy", "moveCount"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw new TypeError(`Invalid 2048 checkpoint ${field}`);
  }
  if (value.score > SCORE_MAX || value.energy < cfg.EnergyMinimum || !Number.isFinite(value.energyDecayGT) || value.energyDecayGT < 0 || value.energyDecayGT > value.runGT) throw new TypeError("Invalid 2048 checkpoint counters");
  const maxTile = getMaxTile(board);
  if (value.maxTile !== maxTile || !canMove(board, cfg.BoardSize)) throw new TypeError("Invalid ended 2048 checkpoint");
  if (typeof value.rngState !== "string" || !/^[0-9a-f]{16}$/i.test(value.rngState)) throw new TypeError("Invalid 2048 checkpoint RNG state");
  return Object.freeze({
    runGT: value.runGT,
    board,
    score: value.score,
    energy: value.energy,
    energyDecayGT: value.energyDecayGT,
    maxTile,
    moveCount: value.moveCount,
    rngState: value.rngState.toLowerCase(),
  });
}
