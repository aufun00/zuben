import { createGameTime, DEADLINE_SETTLEMENT_MS } from "../common/game-time.js";
import { cfg as defaultCfg, STACKER_SHAPES } from "./config.js";
import { createStackerEngine } from "./engine.js";

export const PHASE_INIT = "PHASE_INIT";
export const PHASE_READY = "PHASE_READY";
export const PHASE_RUNNING = "PHASE_RUNNING";
export const PHASE_PAUSED = "PHASE_PAUSED";
export const PHASE_ENDED = "PHASE_ENDED";
export const PHASE_ERROR = "PHASE_ERROR";

export const OPERATION_IDLE = "IDLE";
export const OPERATION_LANDING = "LANDING";
export const OPERATION_MISS = "MISS";

const BAR = "GameBarClick";
const PAUSE = "PauseGame";
const ACTION = "PAction";
const FINISH = "FinishTransition";
const SETTLE = "FinishSettlement";

export function createStackerRuntime({
  cfg = defaultCfg,
  shapes = STACKER_SHAPES,
  seed,
  limitMS,
  readBN = () => performance.now(),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
  onSnapshot,
  onPump,
  onError,
} = {}) {
  if (!Number.isSafeInteger(limitMS) || limitMS <= 0) throw new RangeError("limitMS must be a positive safe integer");
  const gameTime = createGameTime(limitMS);
  const engine = createStackerEngine({ seed, cfg, shapes });
  let phase = PHASE_INIT;
  let operation = OPERATION_IDLE;
  let transition = null;
  let endReason = null;
  let endedGT = null;
  let settling = false;
  let terminalPending = false;
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
    insert(type, BN, data);
    wakePump();
    return true;
  }

  function insert(type, BN, data = null) {
    if (!Number.isFinite(BN)) throw new TypeError("BN must be finite");
    const frozenData = data && typeof data === "object" ? Object.freeze({ ...data }) : data;
    const item = Object.freeze({ BN, sequence: nextSequence++, type, data: frozenData });
    let index = iQ.length;
    while (index > 0 && compare(item, iQ[index - 1]) < 0) index -= 1;
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
      if (phase === PHASE_RUNNING && (settling || terminalPending)) drain(tickBN, tickBN);
      else if (phase === PHASE_RUNNING && deadlineBN !== null && tickBN >= deadlineBN) deadline(tickBN, deadlineBN);
      else drain(tickBN, tickBN);
      publishSnapshot(tickBN);
      if (phase === PHASE_RUNNING) onPump?.(readBN());
    } finally {
      pumping = false;
    }
    if (iQ.length > 0 || phase === PHASE_RUNNING) schedulePump();
  }

  function drain(boundaryBN, tickBN) {
    while (iQ.length > 0 && iQ[0].BN < boundaryBN) {
      handle(iQ.shift(), tickBN);
      if (phase === PHASE_ENDED || phase === PHASE_ERROR) return;
    }
  }

  function deadline(tickBN, deadlineBN) {
    drain(deadlineBN, tickBN);
    if (phase !== PHASE_RUNNING || terminalPending) return;
    operation = OPERATION_IDLE;
    transition = null;
    remove(FINISH);
    beginSettlement(tickBN);
  }

  function handle(item, tickBN) {
    if (item.type === BAR) {
      if (phase === PHASE_READY || phase === PHASE_PAUSED) startAt(tickBN);
      else if (phase === PHASE_RUNNING && terminalPending) end("MISS", endedGT);
      else if (phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
      else if (phase === PHASE_RUNNING) pauseAt(item.BN);
      return;
    }
    if (item.type === PAUSE) {
      if (phase === PHASE_RUNNING && terminalPending) end("MISS", endedGT);
      else if (phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
      else if (phase === PHASE_RUNNING) pauseAt(item.BN);
      return;
    }
    if (item.type === FINISH) {
      if (phase !== PHASE_RUNNING || item.data?.endGT !== transition?.endGT) return;
      if (operation === OPERATION_MISS) end("MISS", endedGT);
      else {
        operation = OPERATION_IDLE;
        transition = null;
      }
      return;
    }
    if (item.type === SETTLE) {
      if (phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
      return;
    }
    if (item.type === ACTION) handleAction(item);
  }

  function startAt(tickBN) {
    phase = PHASE_RUNNING;
    publishSnapshot(tickBN);
    const startBN = readBN();
    if (gameTime.getGT(startBN) === null) gameTime.reset(startBN);
    else gameTime.resume(startBN);
  }

  function handleAction(item) {
    if (phase !== PHASE_RUNNING || operation !== OPERATION_IDLE || settling || terminalPending) return;
    if (item.data?.kind !== "drop") return;
    const actionGT = gameTime.getGT(item.BN);
    if (actionGT === null || actionGT < 0 || actionGT >= limitMS) return;
    const outcome = engine.drop(actionGT);
    const endGT = actionGT + cfg.LandingMS;
    operation = outcome.kind === "miss" ? OPERATION_MISS : OPERATION_LANDING;
    transition = Object.freeze({ kind: outcome.kind, startGT: actionGT, endGT, placed: outcome.placed, layer: outcome.layer ?? null });
    if (outcome.kind === "miss") {
      terminalPending = true;
      endReason = "MISS";
      endedGT = actionGT;
    }
    const finishBN = gameTime.getBN(endGT);
    if (finishBN === null) throw new Error("Stacker transition boundary is unavailable");
    insert(FINISH, finishBN, { endGT });
  }

  function pauseAt(BN) {
    const pauseGT = gameTime.getGT(BN);
    if (pauseGT === null || pauseGT < 0) return;
    if (transition !== null) {
      const targetGT = Math.min(transition.endGT, limitMS);
      gameTime.pauseAndJumpTo(BN, targetGT);
      remove(FINISH);
      operation = OPERATION_IDLE;
      transition = null;
    } else {
      gameTime.pause(BN);
    }
    phase = PHASE_PAUSED;
  }

  function beginSettlement(tickBN) {
    settling = true;
    endReason = "TIME_UP";
    endedGT = limitMS;
    iQ.length = 0;
    insert(SETTLE, tickBN + DEADLINE_SETTLEMENT_MS);
  }

  function end(reason, atGT) {
    phase = PHASE_ENDED;
    settling = false;
    terminalPending = false;
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
    const sampledGT = gameTime.getGT(sampleBN);
    const runGT = phase === PHASE_ENDED || settling ? endedGT : Math.max(0, sampledGT ?? 0);
    const game = engine.snapshot();
    const movingGT = transition?.kind === "miss" ? transition.startGT : runGT;
    latestSnapshot = Object.freeze({
      phase,
      operation,
      runGT,
      remainingMS: Math.max(0, limitMS - runGT),
      score: game.score,
      layerCount: game.layerCount,
      footprint: game.footprint,
      layers: game.layers,
      moving: engine.movingAt(movingGT),
      transition,
      endReason,
      endedGT,
      settling,
      result: phase === PHASE_ENDED ? Object.freeze({ score: game.score, reason: endReason }) : null,
    });
    onSnapshot?.(latestSnapshot);
  }

  function schedulePump() {
    if (destroyed || pumpTimer !== null) return;
    pumpDueBN = readBN() + cfg.PumpWaitMS;
    pumpTimer = setTimer(() => runSafely(pump), cfg.PumpWaitMS);
  }

  function remove(type) {
    for (let index = iQ.length - 1; index >= 0; index -= 1) if (iQ[index].type === type) iQ.splice(index, 1);
  }

  function runSafely(fn) {
    if (destroyed || phase === PHASE_ERROR) return;
    try {
      fn();
    } catch (error) {
      phase = PHASE_ERROR;
      settling = false;
      terminalPending = false;
      operation = OPERATION_IDLE;
      transition = null;
      iQ.length = 0;
      if (pumpTimer !== null) clearTimer(pumpTimer);
      pumpTimer = null;
      pumpDueBN = null;
      publishSnapshot(readBN());
      onError?.(error);
    }
  }

  return Object.freeze({
    snapshot: () => latestSnapshot,
    enqueueGameBarClick: (BN = readBN()) => enqueue(BAR, BN),
    enqueuePause: (BN = readBN()) => enqueue(PAUSE, BN),
    enqueueAction: (BN = readBN()) => enqueue(ACTION, BN, { kind: "drop" }),
    shouldYieldRender: (BN = readBN()) => !destroyed && ((pumpDueBN !== null && BN >= pumpDueBN) || (iQ[0]?.BN ?? Infinity) < BN),
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

function compare(left, right) {
  return left.BN - right.BN || left.sequence - right.sequence;
}
