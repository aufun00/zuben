import { SCORE_MAX } from "../common/protocol-constants.js";
import { createGameTime, DEADLINE_SETTLEMENT_MS } from "../common/game-time.js";

export const PHASE_INIT = "PHASE_INIT";
export const PHASE_READY = "PHASE_READY";
export const PHASE_PREPARING = "PHASE_PREPARING";
export const PHASE_RUNNING = "PHASE_RUNNING";
export const PHASE_PAUSED = "PHASE_PAUSED";
export const PHASE_ENDED = "PHASE_ENDED";
export const PHASE_ERROR = "PHASE_ERROR";

const TYPE_GAME_BAR_CLICK = "GameBarClick";
const TYPE_PAUSE_GAME = "PauseGame";
const TYPE_START_GAME = "StartGame";
const TYPE_PLAYER_ACTION = "PAction";
const TYPE_FINISH_SETTLEMENT = "FinishSettlement";

export function createRunnerRuntime({
  cfg,
  objects,
  road,
  limitMS,
  readBN = () => performance.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
  onSnapshot,
  onPump,
  onError,
}) {
  const gameTime = createGameTime(limitMS);
  let phase = PHASE_INIT;
  let runLane = cfg.InitialLane;
  let runRoadIndex = 0;
  let runSimGT = 0;
  let runDistance = 0;
  let runSpeed = cfg.InitialSpeed;
  let runBlood = cfg.InitialBlood;
  let runScore = 0;
  let runEndReason = null;
  let runEndedGT = null;
  let settling = false;
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
    const item = Object.freeze({ BN, sequence: nextSequence++, type, data: frozenData });
    let index = iQ.length;
    while (index > 0 && compareItems(item, iQ[index - 1]) < 0) index -= 1;
    iQ.splice(index, 0, item);
    wakePump();
    return true;
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
    pumping = true;
    pumpTimer = null;
    pumpDueBN = null;
    const tickBN = readBN();
    try {
      const deadlineBN = gameTime.getDeadlineBN();
      if (phase === PHASE_RUNNING && settling) {
        drainQueue(tickBN, tickBN);
      } else if (phase === PHASE_RUNNING && deadlineBN !== null && tickBN >= deadlineBN) {
        runDeadline(tickBN);
      } else {
        drainQueue(tickBN, tickBN);
        if (phase === PHASE_RUNNING) {
          const currentDeadlineBN = gameTime.getDeadlineBN();
          if (currentDeadlineBN !== null && tickBN >= currentDeadlineBN) runDeadline(tickBN);
          else advanceTo(gameTime.getGT(tickBN));
        }
      }
      publishSnapshot(tickBN);
      if (phase === PHASE_RUNNING) onPump?.(readBN());
    } finally {
      pumping = false;
    }
    if (iQ.length > 0 || phase === PHASE_PREPARING || phase === PHASE_RUNNING) schedulePump();
  }

  function runDeadline(tickBN) {
    const deadlineBN = gameTime.getDeadlineBN();
    if (deadlineBN === null) throw new Error("Runner deadline is unavailable");
    drainQueue(deadlineBN, tickBN);
    if (phase !== PHASE_RUNNING) return;
    advanceTo(limitMS, false);
    if (phase === PHASE_RUNNING) beginSettlement(tickBN);
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
        removeQueuedStarts();
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
    if (item.type === TYPE_PLAYER_ACTION) {
      if (phase !== PHASE_RUNNING || settling) return;
      const actionGT = gameTime.getGT(item.BN);
      if (actionGT === null || actionGT < runSimGT) return;
      advanceTo(Math.min(actionGT, limitMS));
      if (phase !== PHASE_RUNNING || actionGT > limitMS) return;
      const nextLane = runLane + item.data.laneDelta;
      if (nextLane >= 0 && nextLane <= 2) runLane = nextLane;
    }
  }

  function beginPreparing(tickBN) {
    removeQueuedStarts();
    phase = PHASE_PREPARING;
    insertInternal(TYPE_START_GAME, tickBN + cfg.PrepareMS);
  }

  function pauseAt(BN) {
    const pauseGT = gameTime.getGT(BN);
    if (pauseGT === null || pauseGT < runSimGT) return;
    advanceTo(Math.min(pauseGT, limitMS));
    if (phase !== PHASE_RUNNING) return;
    gameTime.pause(BN);
    phase = PHASE_PAUSED;
  }

  function advanceTo(targetGT, includeBoundary = true) {
    if (phase !== PHASE_RUNNING || !Number.isFinite(targetGT) || targetGT < runSimGT) return;
    while (runRoadIndex < road.length) {
      const station = road[runRoadIndex];
      const distanceLeft = station.at - runDistance;
      const arrivalGT = runSimGT + distanceLeft * cfg.NormalSpeed / runSpeed * 1_000;
      if (arrivalGT > targetGT || (!includeBoundary && arrivalGT === targetGT)) break;
      runSimGT = arrivalGT;
      runDistance = station.at;
      collide(station.lanes[runLane]);
      runRoadIndex += 1;
      if (phase !== PHASE_RUNNING) return;
    }
    const deltaGT = targetGT - runSimGT;
    runDistance += runSpeed / cfg.NormalSpeed * deltaGT / 1_000;
    runSimGT = targetGT;
  }

  function collide(objectKey) {
    if (objectKey === null) return;
    const object = objects[objectKey];
    const scoreDelta = Math.round(cfg.RewardBaseScore * object.runScoreFactor * runSpeed / cfg.NormalSpeed);
    const nextScore = clamp(runScore + scoreDelta, 0, SCORE_MAX);
    const nextBlood = clamp(runBlood + object.runBloodDelta, 0, cfg.MaxBlood);
    const nextSpeed = clamp(runSpeed + object.runSpeedDelta, cfg.MinSpeed, cfg.MaxSpeed);
    runScore = nextScore;
    runBlood = nextBlood;
    runSpeed = nextSpeed;
    if (runBlood === 0) end("HP_ZERO", runSimGT);
  }

  function end(reason, atGT) {
    phase = PHASE_ENDED;
    settling = false;
    runEndReason = reason;
    runEndedGT = atGT;
    removeQueuedStarts();
    iQ.length = 0;
    if (pumpTimer !== null) clearTimer(pumpTimer);
    pumpTimer = null;
    pumpDueBN = null;
  }

  function publishSnapshot(sampleBN) {
    const prepareAt = iQ.find((item) => item.type === TYPE_START_GAME)?.BN ?? null;
    const prepareRemainingMS = phase === PHASE_PREPARING && prepareAt !== null ? Math.max(0, prepareAt - sampleBN) : 0;
    latestSnapshot = Object.freeze({
      phase,
      runGT: runSimGT,
      remainingMS: Math.max(0, limitMS - runSimGT),
      prepareRemainingMS,
      runDistance,
      runLane,
      runRoadIndex,
      runSpeed,
      runBlood,
      runScore,
      runEndReason,
      runEndedGT,
      settling,
      result: phase === PHASE_ENDED ? Object.freeze({ score: runScore, reason: runEndReason }) : null,
    });
    onSnapshot?.(latestSnapshot);
  }

  function beginSettlement(tickBN) {
    settling = true;
    runEndReason = "TIME_UP";
    runEndedGT = limitMS;
    iQ.length = 0;
    insertInternal(TYPE_FINISH_SETTLEMENT, tickBN + DEADLINE_SETTLEMENT_MS);
  }

  function schedulePump() {
    if (destroyed || pumpTimer !== null) return;
    pumpDueBN = readBN() + cfg.PumpWaitMS;
    pumpTimer = setTimer(() => runSafely(pump), cfg.PumpWaitMS);
  }

  function insertInternal(type, BN) {
    const item = Object.freeze({ BN, sequence: nextSequence++, type, data: null });
    let index = iQ.length;
    while (index > 0 && compareItems(item, iQ[index - 1]) < 0) index -= 1;
    iQ.splice(index, 0, item);
  }

  function removeQueuedStarts() {
    for (let index = iQ.length - 1; index >= 0; index -= 1) {
      if (iQ[index].type === TYPE_START_GAME) iQ.splice(index, 1);
    }
  }

  function runSafely(operation) {
    if (destroyed || phase === PHASE_ERROR) return;
    try {
      operation();
    } catch (error) {
      phase = PHASE_ERROR;
      settling = false;
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
    enqueueAction(laneDelta, BN = readBN()) {
      if (laneDelta !== -1 && laneDelta !== 1) throw new RangeError("laneDelta must be -1 or 1");
      return enqueue(TYPE_PLAYER_ACTION, BN, { laneDelta });
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

function compareItems(left, right) {
  return left.BN - right.BN || left.sequence - right.sequence;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
