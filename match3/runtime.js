import { SCORE_MAX } from "../common/protocol-constants.js";
import { createGameTime, DEADLINE_SETTLEMENT_MS } from "../common/game-time.js";
import { createLogicRng } from "../common/rng.js";
import { EFFECT_NONE } from "./config.js";
import { EMPTY, areAdjacentIndices, boardHasLegalMove, buildClearPlan, collapseAndFill, findMatches, validateMatch3Config } from "./engine.js";

export const PHASE_INIT = "PHASE_INIT";
export const PHASE_READY = "PHASE_READY";
export const PHASE_PREPARING = "PHASE_PREPARING";
export const PHASE_RUNNING = "PHASE_RUNNING";
export const PHASE_PAUSED = "PHASE_PAUSED";
export const PHASE_ENDED = "PHASE_ENDED";
export const PHASE_ERROR = "PHASE_ERROR";
export const OPERATION_IDLE = "IDLE";
export const OPERATION_SWAP = "SWAP";
export const OPERATION_SWAP_BACK = "SWAP_BACK";
export const OPERATION_RESOLVE = "RESOLVE";

const START = "StartGame", BAR = "GameBarClick", PAUSE = "PauseGame", ACTION = "PAction", FINISH = "FinishTransition", SETTLE = "FinishSettlement";
const UINT32_RANGE = 0x1_0000_0000;

export function createMatch3Runtime({ cfg, seed, limitMS, readBN = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, onSnapshot, onPump, onError }) {
  validateMatch3Config(cfg);
  if (!(seed instanceof Uint8Array) || seed.length !== 6) throw new TypeError("seed must be a 6-byte Uint8Array");
  const clock = createGameTime(limitMS), rng = createLogicRng(seed), size = cfg.BoardSize, count = size ** 2;
  let types = [], effects = [];
  for (let index = 0; index < count; index += 1) { const cell = generateCell(); types.push(cell.type); effects.push(cell.effect); }
  types = freeze(types); effects = freeze(effects);
  let phase = PHASE_READY, operation = OPERATION_IDLE, transition = null, score = 0, energy = cfg.EnergyInitial, decayGT = 0;
  let chain = 0, clearCount = 0, moveCount = 0, endReason = null, endedGT = null, settling = false, pendingCheck = false;
  let sequence = 0, destroyed = false, pumping = false, timer = null, timerDue = null, latest = null;
  const queue = [];
  publish(readBN());

  function generateCell() {
    const type = weighted(cfg.TileWeights);
    let effect = EFFECT_NONE;
    if (bounded(cfg.MysteryDenominator) < cfg.MysteryNumerator) effect = weighted(cfg.EffectWeights) + 1;
    return Object.freeze({ type, effect });
  }
  function bounded(bound) { const ceiling = Math.floor(UINT32_RANGE / bound) * bound; let value; do value = rng.nextUint32(); while (value >= ceiling); return value % bound; }
  function weighted(weights) { const total = weights.reduce((sum, value) => sum + value, 0); let pick = bounded(total); for (let index = 0; index < weights.length; index += 1) { if (pick < weights[index]) return index; pick -= weights[index]; } throw new Error("weighted selection failed"); }

  function enqueue(type, BN, data = null) { if (destroyed || phase === PHASE_ENDED || phase === PHASE_ERROR) return false; insert(type, BN, data); wake(); return true; }
  function insert(type, BN, data = null) {
    if (!Number.isFinite(BN)) throw new TypeError("BN must be finite");
    const item = Object.freeze({ type, BN, sequence: sequence++, data: data && typeof data === "object" ? Object.freeze({ ...data }) : data });
    let index = queue.length; while (index && (item.BN < queue[index - 1].BN || item.BN === queue[index - 1].BN && item.sequence < queue[index - 1].sequence)) index -= 1;
    queue.splice(index, 0, item);
  }
  function wake() { if (destroyed || pumping) return; if (timer !== null) clearTimer(timer); timer = null; timerDue = null; safe(pump); }
  function pump() {
    if (destroyed || pumping) return;
    timer = null; timerDue = null; pumping = true;
    try {
      const tickBN = readBN(), deadlineBN = clock.getDeadlineBN();
      if (phase === PHASE_RUNNING && settling) drain(tickBN, tickBN);
      else if (phase === PHASE_RUNNING && deadlineBN !== null && tickBN >= deadlineBN) deadline(tickBN, deadlineBN);
      else drain(tickBN, tickBN);
      publish(tickBN);
      if (phase === PHASE_RUNNING) onPump?.(readBN());
    } finally { pumping = false; }
    if (queue.length || phase === PHASE_PREPARING || phase === PHASE_RUNNING) schedule();
  }
  function drain(boundary, tickBN) { while (queue.length && queue[0].BN < boundary) { handle(queue.shift(), tickBN); if (phase === PHASE_ENDED || phase === PHASE_ERROR) return; } }
  function deadline(tickBN, deadlineBN) {
    drain(deadlineBN, tickBN);
    if (phase !== PHASE_RUNNING) return;
    settleEnergy(limitMS); operation = OPERATION_IDLE; transition = null; pendingCheck = false; queue.length = 0;
    settling = true; endReason = "TIME_UP"; endedGT = limitMS; insert(SETTLE, tickBN + DEADLINE_SETTLEMENT_MS);
  }
  function handle(item, tickBN) {
    if (item.type === BAR) {
      if (phase === PHASE_READY || phase === PHASE_PAUSED) prepare(tickBN);
      else if (phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
      else if (phase === PHASE_RUNNING) pauseAt(item.BN);
    } else if (item.type === PAUSE) {
      if (phase === PHASE_PREPARING) { remove(START); phase = PHASE_PAUSED; }
      else if (phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
      else if (phase === PHASE_RUNNING) pauseAt(item.BN);
    } else if (item.type === START && phase === PHASE_PREPARING) {
      phase = PHASE_RUNNING; publish(tickBN);
      const startBN = readBN(); if (clock.getGT(startBN) === null) clock.reset(startBN); else clock.resume(startBN);
      if (pendingCheck || chain === 0 && moveCount === 0) { pendingCheck = false; checkBoard(clock.getGT(startBN) ?? 0, chain || 1); }
    } else if (item.type === ACTION) action(item);
    else if (item.type === FINISH) finishTransition(item);
    else if (item.type === SETTLE && settling) end("TIME_UP", limitMS);
  }
  function action(item) {
    if (phase !== PHASE_RUNNING || settling || operation !== OPERATION_IDLE) return;
    const { fromIndex, toIndex } = item.data ?? {};
    if (!areAdjacentIndices(fromIndex, toIndex, size)) return;
    const actionGT = clock.getGT(item.BN); if (actionGT === null || actionGT < 0 || actionGT >= limitMS) return;
    settleEnergy(actionGT);
    const beforeTypes = types, beforeEffects = effects, nextTypes = [...types], nextEffects = [...effects];
    [nextTypes[fromIndex], nextTypes[toIndex]] = [nextTypes[toIndex], nextTypes[fromIndex]];
    [nextEffects[fromIndex], nextEffects[toIndex]] = [nextEffects[toIndex], nextEffects[fromIndex]];
    types = freeze(nextTypes); effects = freeze(nextEffects); chain = 1; moveCount += 1;
    beginTransition(OPERATION_SWAP, actionGT, actionGT + cfg.SwapMS, { beforeTypes, beforeEffects, afterTypes: types, afterEffects: effects, fromIndex, toIndex });
  }
  function finishTransition(item) {
    if (phase !== PHASE_RUNNING || item.data?.endGT !== transition?.endGT) return;
    const atGT = transition.endGT, finished = operation, saved = transition;
    operation = OPERATION_IDLE; transition = null;
    if (finished === OPERATION_SWAP) {
      const matches = findMatches(types, size);
      if (!matches.length) {
        types = saved.beforeTypes; effects = saved.beforeEffects;
        beginTransition(OPERATION_SWAP_BACK, atGT, atGT + cfg.SwapBackMS, { beforeTypes: saved.afterTypes, beforeEffects: saved.afterEffects, afterTypes: types, afterEffects: effects, fromIndex: saved.toIndex, toIndex: saved.fromIndex });
      } else resolve(matches, atGT, 1, cfg.ClearMS + cfg.FallMS);
    } else if (finished === OPERATION_RESOLVE) checkBoard(atGT, chain + 1);
    else if (finished === OPERATION_SWAP_BACK) stable(atGT);
  }
  function checkBoard(atGT, nextChain) {
    const matches = findMatches(types, size);
    if (matches.length) resolve(matches, atGT, nextChain, cfg.ClearMS + cfg.FallMS);
    else stable(atGT);
  }
  function resolve(matches, atGT, nextChain, duration) {
    settleEnergy(atGT); chain = nextChain;
    const beforeTypes = types, beforeEffects = effects, plan = buildClearPlan(types, effects, size, matches);
    const emptiedTypes = [...types], emptiedEffects = [...effects];
    for (const index of plan.cells) { emptiedTypes[index] = EMPTY; emptiedEffects[index] = EFFECT_NONE; }
    const collapsed = collapseAndFill(emptiedTypes, emptiedEffects, size, generateCell);
    types = collapsed.types; effects = collapsed.effects; clearCount += plan.count;
    energy = Math.min(Number.MAX_SAFE_INTEGER, energy + plan.count * cfg.EnergyPerCell);
    const coefficient = Math.max(1, energy / cfg.ScoreEnergyDivisor);
    score = Math.min(SCORE_MAX, score + Math.floor(plan.count * chain * coefficient));
    beginTransition(OPERATION_RESOLVE, atGT, atGT + duration, { beforeTypes, beforeEffects, afterTypes: types, afterEffects: effects, marks: plan.marks, triggered: plan.triggered, effectCells: plan.effectCells, motions: collapsed.motions, clearEndGT: atGT + cfg.ClearMS, thisCount: plan.count, chain });
  }
  function stable(atGT) { chain = 0; if (!boardHasLegalMove(types, size)) end("NO_MOVES", atGT); }
  function beginTransition(kind, startGT, endGT, data) {
    operation = kind; transition = Object.freeze({ startGT, endGT, ...data });
    const BN = clock.getBN(endGT); if (BN === null) throw new Error("transition boundary unavailable"); insert(FINISH, BN, { endGT });
  }
  function prepare(tickBN) { remove(START); phase = PHASE_PREPARING; insert(START, tickBN + cfg.PrepareMS); }
  function pauseAt(BN) {
    const atGT = clock.getGT(BN); if (atGT === null || atGT < 0) return;
    if (transition) {
      const target = Math.min(transition.endGT, limitMS); settleEnergy(target); clock.pauseAndJumpTo(BN, target); remove(FINISH);
      if (operation === OPERATION_SWAP) {
        const matches = findMatches(types, size);
        if (!matches.length) { types = transition.beforeTypes; effects = transition.beforeEffects; pendingCheck = false; chain = 0; }
        else pendingCheck = true;
      } else if (operation === OPERATION_RESOLVE) pendingCheck = true;
      operation = OPERATION_IDLE; transition = null;
    } else { settleEnergy(atGT); clock.pause(BN); }
    phase = PHASE_PAUSED;
  }
  function end(reason, atGT) { phase = PHASE_ENDED; settling = false; operation = OPERATION_IDLE; transition = null; pendingCheck = false; endReason = reason; endedGT = atGT; queue.length = 0; if (timer !== null) clearTimer(timer); timer = null; timerDue = null; }
  function settleEnergy(atGT) { if (!Number.isFinite(atGT) || atGT < decayGT) return; const ticks = Math.floor((atGT - decayGT) / cfg.EnergyDecayMS); if (ticks > 0) { decayGT += ticks * cfg.EnergyDecayMS; energy = Math.max(0, energy - ticks * cfg.EnergyDecayDelta); } }
  function publish(sampleBN) {
    const preparingAt = queue.find((item) => item.type === START)?.BN ?? null, sampled = clock.getGT(sampleBN);
    const runGT = phase === PHASE_ENDED || settling ? endedGT : Math.max(0, sampled ?? 0);
    if (phase === PHASE_RUNNING) settleEnergy(Math.min(runGT, limitMS));
    latest = Object.freeze({ phase, operation, runGT, remainingMS: Math.max(0, limitMS - runGT), prepareRemainingMS: phase === PHASE_PREPARING && preparingAt !== null ? Math.max(0, preparingAt - sampleBN) : 0, types, effects, score, energy, chain, clearCount, moveCount, transition, endReason, endedGT, settling, result: phase === PHASE_ENDED ? Object.freeze({ score, reason: endReason }) : null });
    onSnapshot?.(latest);
  }
  function schedule() { if (destroyed || timer !== null) return; timerDue = readBN() + cfg.PumpWaitMS; timer = setTimer(() => safe(pump), cfg.PumpWaitMS); }
  function remove(type) { for (let index = queue.length - 1; index >= 0; index -= 1) if (queue[index].type === type) queue.splice(index, 1); }
  function safe(fn) { if (destroyed || phase === PHASE_ERROR) return; try { fn(); } catch (error) { phase = PHASE_ERROR; settling = false; operation = OPERATION_IDLE; transition = null; queue.length = 0; if (timer !== null) clearTimer(timer); timer = null; timerDue = null; publish(readBN()); onError?.(error); } }

  return Object.freeze({
    snapshot: () => latest,
    enqueueGameBarClick: (BN = readBN()) => enqueue(BAR, BN),
    enqueuePause: (BN = readBN()) => enqueue(PAUSE, BN),
    enqueueAction: (fromIndex, toIndex, BN = readBN()) => enqueue(ACTION, BN, { fromIndex, toIndex }),
    shouldYieldRender: (BN = readBN()) => !destroyed && ((timerDue !== null && BN >= timerDue) || (queue[0]?.BN ?? Infinity) < BN),
    wakePump: wake,
    destroy() { destroyed = true; if (timer !== null) clearTimer(timer); timer = null; timerDue = null; queue.length = 0; },
  });
}

function freeze(values) { return Object.freeze(Array.from(values)); }
