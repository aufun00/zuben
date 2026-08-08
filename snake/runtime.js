import { SCORE_MAX } from "../common/protocol-constants.js";
import { createGameTime, DEADLINE_SETTLEMENT_MS } from "../common/game-time.js";
import { createLogicRng } from "../common/rng.js";
import {
  REWARD_ANT,
  REWARD_COIN,
  REWARD_FORAGE,
  REWARD_MYSTERY,
  REWARD_PREDATION,
  chooseRewardCell,
  createInitialSnake,
  createReward,
  drawMysteryType,
  drawRewardType,
  getStepMS,
  isDirection,
  isOpposite,
  nextCell,
  rewardEffect,
  validateSnakeConfig,
  validateSnakeState,
} from "./engine.js";
import {
  SNAKE_SOUND_ANT,
  SNAKE_SOUND_COIN,
  SNAKE_SOUND_DEATH,
  SNAKE_SOUND_FORAGE,
  SNAKE_SOUND_MYSTERY,
  SNAKE_SOUND_PREDATION,
} from "./sound.js";

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
const TYPE_STEP = "SnakeStep";
const TYPE_REWARD_EXPIRE = "RewardExpire";
const TYPE_FINISH_SETTLEMENT = "FinishSettlement";

export function createSnakeRuntime({
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
  validateSnakeConfig(cfg);
  if (!(seed instanceof Uint8Array) || seed.length !== 6) throw new TypeError("seed must be a 6-byte Uint8Array");
  const unlimited = limitMS === null;
  if (!unlimited && (!Number.isSafeInteger(limitMS) || limitMS <= 0)) throw new RangeError("limitMS must be null or a positive safe integer");
  if (checkpoint !== null && !unlimited) throw new TypeError("Only unlimited Snake games can restore checkpoints");
  const restored = checkpoint === null ? null : normalizeCheckpoint(checkpoint, cfg);
  const gameTime = createGameTime(limitMS);
  const rng = createLogicRng(seed, restored?.rngState ?? null);

  let phase = PHASE_INIT;
  let snake = restored?.snake ?? createInitialSnake(cfg.BoardSize, cfg.InitialLength);
  let segmentKinds = restored?.segmentKinds ?? Object.freeze(Array(snake.length).fill("snake"));
  let direction = restored?.direction ?? "east";
  let pendingDirection = null;
  let growthKinds = restored?.growthKinds ?? Object.freeze([]);
  let rewards = restored?.rewards ?? Object.freeze([]);
  let nextRewardSerial = restored?.nextRewardSerial ?? 0;
  let nextStepGT = restored?.nextStepGT ?? cfg.InitialStepMS;
  let score = restored?.score ?? 0;
  let energy = restored?.energy ?? cfg.EnergyInitial;
  let energyDecayGT = restored?.energyDecayGT ?? 0;
  let stepCount = restored?.stepCount ?? 0;
  let pickupCount = restored?.pickupCount ?? 0;
  let feedbackSequence = 0;
  let lastFeedback = null;
  let feedbacks = Object.freeze([]);
  let lastSound = null;
  let endReason = null;
  let endedGT = null;
  let settling = false;
  let nextSequence = 0;
  let destroyed = false;
  let pumping = false;
  let pumpTimer = null;
  let pumpDueBN = null;
  let latestSnapshot = null;
  let latestCheckpoint = null;
  let checkpointRevision = 0;
  const iQ = [];

  if (restored === null) {
    refillRewards(0);
    phase = PHASE_READY;
  } else {
    const anchorBN = readBN();
    gameTime.reset(anchorBN - restored.runGT);
    gameTime.pause(anchorBN);
    phase = PHASE_PAUSED;
    latestCheckpoint = freezeCheckpoint(restored.runGT);
    checkpointRevision = 1;
  }
  publishSnapshot(readBN());

  function enqueue(type, BN, data = null) {
    if (destroyed || phase === PHASE_ENDED || phase === PHASE_ERROR) return false;
    if (!Number.isFinite(BN)) throw new TypeError("BN must be finite");
    insertItem(Object.freeze({ BN, sequence: nextSequence++, type, data: freezeData(data) }));
    wakePump();
    return true;
  }

  function insertInternal(type, BN, data = null) {
    insertItem(Object.freeze({ BN, sequence: nextSequence++, type, data: freezeData(data) }));
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
      if (phase === PHASE_RUNNING && deadlineBN !== null && tickBN >= deadlineBN) runDeadline(tickBN);
      else drainQueue(tickBN, tickBN);
      publishSnapshot(tickBN);
      if (phase === PHASE_RUNNING) onPump?.(readBN());
    } finally { pumping = false; }
    if (iQ.length > 0 || phase === PHASE_PREPARING || phase === PHASE_RUNNING) schedulePump();
  }

  function runDeadline(tickBN) {
    const deadlineBN = gameTime.getDeadlineBN();
    if (deadlineBN === null) throw new Error("Snake deadline is unavailable");
    drainQueue(deadlineBN, tickBN);
    if (phase === PHASE_RUNNING) {
      settleEnergy(limitMS);
      removeQueued(TYPE_STEP);
      beginSettlement(tickBN);
    }
  }

  function drainQueue(upToBN, tickBN) {
    while (iQ.length > 0 && iQ[0].BN < upToBN) {
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
      if (phase === PHASE_PREPARING) { removeQueued(TYPE_START_GAME); phase = PHASE_PAUSED; }
      else if (phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
      else if (phase === PHASE_RUNNING) pauseAt(item.BN);
      return;
    }
    if (item.type === TYPE_START_GAME) {
      if (phase !== PHASE_PREPARING) return;
      phase = PHASE_RUNNING;
      publishSnapshot(tickBN);
      const startBN = readBN();
      if (gameTime.getGT(startBN) === null) gameTime.reset(startBN);
      else gameTime.resume(startBN);
      scheduleBoundaries();
      return;
    }
    if (item.type === TYPE_PLAYER_ACTION) {
      if (phase !== PHASE_RUNNING || settling) return;
      const actionGT = gameTime.getGT(item.BN);
      if (actionGT === null || actionGT < 0 || (!unlimited && actionGT >= limitMS)) return;
      const requested = item.data?.direction;
      if (!isOpposite(direction, requested)) pendingDirection = requested;
      return;
    }
    if (item.type === TYPE_STEP) {
      if (phase !== PHASE_RUNNING || settling || item.data?.stepGT !== nextStepGT) return;
      performStep(item.data.stepGT);
      return;
    }
    if (item.type === TYPE_REWARD_EXPIRE) {
      if (phase !== PHASE_RUNNING || settling || item.data?.expiresGT !== earliestExpiryGT()) return;
      expireRewards(item.data.expiresGT);
      return;
    }
    if (item.type === TYPE_FINISH_SETTLEMENT && phase === PHASE_RUNNING && settling) end("TIME_UP", limitMS);
  }

  function performStep(stepGT) {
    settleEnergy(stepGT);
    const nextDirection = pendingDirection ?? direction;
    pendingDirection = null;
    const head = nextCell(snake[0], nextDirection, cfg.BoardSize);
    if (head < 0) { die("WALL", stepGT); return; }

    const tailWillMove = growthKinds.length === 0;
    const collisionLength = tailWillMove ? snake.length - 1 : snake.length;
    for (let index = 0; index < collisionLength; index += 1) {
      if (snake[index] === head) { die("BODY", stepGT); return; }
    }

    direction = nextDirection;
    const picked = rewards.find((reward) => reward.index === head) ?? null;
    let resolvedType = null;
    let effect = null;
    let wasMystery = false;
    if (picked !== null) {
      wasMystery = picked.type === REWARD_MYSTERY;
      resolvedType = wasMystery ? drawMysteryType(rng) : picked.type;
      effect = rewardEffect(resolvedType);
    }

    let nextGrowth = [...growthKinds];
    if (effect) for (let index = 0; index < effect.growth; index += 1) nextGrowth.push(index === 0 ? effect.segmentKind : "snake");
    const nextSnake = [head, ...snake];
    const nextKinds = ["snake", ...segmentKinds];
    if (nextGrowth.length > 0) {
      const addedKind = nextGrowth.shift();
      if (addedKind === "ant") {
        for (let index = nextKinds.length - 1; index >= 0; index -= 1) {
          if (nextKinds[index] === "snake") { nextKinds[index] = "ant"; break; }
        }
      }
    } else {
      nextSnake.pop();
      nextKinds.pop();
    }
    snake = Object.freeze(nextSnake);
    segmentKinds = Object.freeze(nextKinds);
    growthKinds = Object.freeze(nextGrowth);
    stepCount += 1;

    if (picked !== null) {
      rewards = Object.freeze(rewards.filter((reward) => reward.id !== picked.id));
      pickupCount += 1;
      applyPickup({ picked, resolvedType, effect, wasMystery, stepGT });
    }

    if (!refillRewards(stepGT)) { end("BOARD_FILLED", stepGT); return; }
    nextStepGT = stepGT + getStepMS(stepGT, cfg);
    captureCheckpoint(stepGT);
    scheduleBoundaries();
  }

  function applyPickup({ picked, resolvedType, effect, wasMystery, stepGT }) {
    const scoreDelta = effect.scoreUnits === 0 ? 0 : Math.floor(effect.scoreUnits * energy / cfg.ScoreEnergyDivisor);
    score = Math.min(SCORE_MAX, score + scoreDelta);
    energy = Math.min(cfg.EnergyMaximum, energy + effect.energyUnits * cfg.EnergyPerUnit);
    const showNumber = !(wasMystery && resolvedType === REWARD_ANT);
    lastFeedback = Object.freeze({
      id: ++feedbackSequence,
      atGT: stepGT,
      index: picked.index,
      text: showNumber ? `+${effect.growth || effect.scoreUnits}` : "",
      type: picked.type,
      resolvedType,
      mystery: wasMystery,
    });
    feedbacks = Object.freeze([...feedbacks.filter((item) => stepGT - item.atGT < 700), lastFeedback].slice(-6));
    lastSound = Object.freeze({ id: feedbackSequence, atGT: stepGT, soundID: soundFor(picked.type, resolvedType) });
  }

  function refillRewards(atGT) {
    while (rewards.length < cfg.RewardCount) {
      const type = drawRewardType(rng);
      const occupied = new Set([...snake, ...rewards.map((reward) => reward.index)]);
      const index = chooseRewardCell({ type, size: cfg.BoardSize, edgeWidth: cfg.EdgeBandWidth, occupied, rng });
      if (index < 0) return false;
      const reward = createReward({ type, index, bornGT: atGT, serial: nextRewardSerial++, lifetimeMS: cfg.RewardLifetimeMS });
      rewards = Object.freeze([...rewards, reward]);
    }
    return true;
  }

  function beginPreparing(tickBN) {
    removeQueued(TYPE_START_GAME);
    removeQueued(TYPE_STEP);
    removeQueued(TYPE_REWARD_EXPIRE);
    phase = PHASE_PREPARING;
    insertInternal(TYPE_START_GAME, tickBN + cfg.PrepareMS);
  }

  function scheduleBoundaries() {
    if (phase !== PHASE_RUNNING) return;
    removeQueued(TYPE_STEP);
    removeQueued(TYPE_REWARD_EXPIRE);
    const BN = gameTime.getBN(nextStepGT);
    if (BN === null) throw new Error("Snake step boundary is unavailable");
    insertInternal(TYPE_STEP, BN, { stepGT: nextStepGT });
    const expiresGT = earliestExpiryGT();
    if (expiresGT !== null) {
      const expiresBN = gameTime.getBN(expiresGT);
      if (expiresBN === null) throw new Error("Snake reward expiry boundary is unavailable");
      insertInternal(TYPE_REWARD_EXPIRE, expiresBN, { expiresGT });
    }
  }

  function earliestExpiryGT() {
    let earliest = Infinity;
    for (const reward of rewards) earliest = Math.min(earliest, reward.expiresGT);
    return Number.isFinite(earliest) ? earliest : null;
  }

  function expireRewards(atGT) {
    settleEnergy(atGT);
    rewards = Object.freeze(rewards.filter((reward) => reward.expiresGT > atGT));
    if (!refillRewards(atGT)) { end("BOARD_FILLED", atGT); return; }
    captureCheckpoint(atGT);
    scheduleBoundaries();
  }

  function pauseAt(BN) {
    const pauseGT = gameTime.getGT(BN);
    if (pauseGT === null || pauseGT < 0) return;
    settleEnergy(pauseGT);
    gameTime.pause(BN);
    removeQueued(TYPE_STEP);
    removeQueued(TYPE_REWARD_EXPIRE);
    pendingDirection = null;
    phase = PHASE_PAUSED;
  }

  function die(reason, atGT) {
    lastSound = Object.freeze({ id: ++feedbackSequence, atGT, soundID: SNAKE_SOUND_DEATH });
    end(reason, atGT);
  }

  function end(reason, atGT) {
    phase = PHASE_ENDED;
    settling = false;
    endReason = reason;
    endedGT = atGT;
    pendingDirection = null;
    iQ.length = 0;
    if (pumpTimer !== null) clearTimer(pumpTimer);
    pumpTimer = null;
    pumpDueBN = null;
  }

  function beginSettlement(tickBN) {
    settling = true;
    endReason = "TIME_UP";
    endedGT = limitMS;
    pendingDirection = null;
    iQ.length = 0;
    insertInternal(TYPE_FINISH_SETTLEMENT, tickBN + DEADLINE_SETTLEMENT_MS);
  }

  function publishSnapshot(sampleBN) {
    const prepareAt = iQ.find((item) => item.type === TYPE_START_GAME)?.BN ?? null;
    const sampledGT = gameTime.getGT(sampleBN);
    const runGT = phase === PHASE_ENDED || settling ? endedGT : Math.max(0, sampledGT ?? 0);
    if (phase === PHASE_RUNNING) settleEnergy(unlimited ? runGT : Math.min(runGT, limitMS));
    latestSnapshot = Object.freeze({
      phase,
      runGT,
      remainingMS: unlimited ? null : Math.max(0, limitMS - runGT),
      prepareRemainingMS: phase === PHASE_PREPARING && prepareAt !== null ? Math.max(0, prepareAt - sampleBN) : 0,
      snake,
      segmentKinds,
      direction,
      pendingDirection,
      growthRemaining: growthKinds.length,
      rewards,
      score,
      energy,
      scoreMultiplier: energy / cfg.ScoreEnergyDivisor,
      stepMS: getStepMS(runGT, cfg),
      stepCount,
      pickupCount,
      lastFeedback,
      feedbacks,
      lastSound,
      endReason,
      endedGT,
      settling,
      checkpoint: latestCheckpoint,
      checkpointRevision,
      result: phase === PHASE_ENDED ? Object.freeze({ score, reason: endReason }) : null,
    });
    onSnapshot?.(latestSnapshot);
  }

  function settleEnergy(atGT) {
    if (!Number.isFinite(atGT) || atGT < energyDecayGT) return;
    const ticks = Math.floor((atGT - energyDecayGT) / cfg.EnergyDecayMS);
    if (ticks <= 0) return;
    energyDecayGT += ticks * cfg.EnergyDecayMS;
    energy = Math.max(cfg.EnergyMinimum, energy - ticks * cfg.EnergyDecayDelta);
  }

  function captureCheckpoint(runGT) {
    if (!unlimited) return;
    latestCheckpoint = freezeCheckpoint(runGT);
    checkpointRevision += 1;
  }

  function freezeCheckpoint(runGT) {
    return Object.freeze({
      version: 1,
      runGT,
      snake,
      segmentKinds,
      direction,
      growthKinds,
      rewards,
      nextRewardSerial,
      nextStepGT,
      score,
      energy,
      energyDecayGT,
      stepCount,
      pickupCount,
      rngState: rng.exportState(),
    });
  }

  function schedulePump() {
    if (destroyed || pumpTimer !== null) return;
    pumpDueBN = readBN() + cfg.PumpWaitMS;
    pumpTimer = setTimer(() => runSafely(pump), cfg.PumpWaitMS);
  }

  function removeQueued(type) {
    for (let index = iQ.length - 1; index >= 0; index -= 1) if (iQ[index].type === type) iQ.splice(index, 1);
  }

  function runSafely(operation) {
    if (destroyed || phase === PHASE_ERROR) return;
    try { operation(); }
    catch (error) {
      phase = PHASE_ERROR;
      settling = false;
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
    enqueueGameBarClick: (BN = readBN()) => enqueue(TYPE_GAME_BAR_CLICK, BN),
    enqueuePause: (BN = readBN()) => enqueue(TYPE_PAUSE_GAME, BN),
    enqueueAction(requested, BN = readBN()) {
      if (!isDirection(requested)) throw new RangeError("direction must be north, east, south, or west");
      return enqueue(TYPE_PLAYER_ACTION, BN, { direction: requested });
    },
    shouldYieldRender(BN = readBN()) { return !destroyed && ((pumpDueBN !== null && BN >= pumpDueBN) || (iQ[0]?.BN ?? Infinity) < BN); },
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

function normalizeCheckpoint(value, cfg) {
  if (!value || typeof value !== "object" || value.version !== 1 || !Number.isFinite(value.runGT) || value.runGT < 0) throw new TypeError("Invalid Snake checkpoint");
  const snake = Object.freeze(Array.isArray(value.snake) ? [...value.snake] : []);
  const segmentKinds = Object.freeze(Array.isArray(value.segmentKinds) ? [...value.segmentKinds] : []);
  const rewards = Object.freeze(Array.isArray(value.rewards) ? value.rewards.map((reward) => Object.freeze({ ...reward })) : []);
  validateSnakeState({ snake, segmentKinds, rewards, size: cfg.BoardSize });
  if (!isDirection(value.direction) || !Array.isArray(value.growthKinds) || value.growthKinds.some((kind) => kind !== "snake" && kind !== "ant")) throw new TypeError("Invalid Snake checkpoint direction or growth");
  for (const reward of rewards) {
    if (!Number.isSafeInteger(reward.id) || reward.id < 0 || !Number.isFinite(reward.bornGT) || reward.bornGT < 0 || !Number.isFinite(reward.expiresGT) || reward.expiresGT <= reward.bornGT || !Number.isSafeInteger(reward.variant) || reward.variant < 0) throw new TypeError("Invalid Snake checkpoint reward");
  }
  for (const field of ["nextRewardSerial", "score", "energy", "stepCount", "pickupCount"]) if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw new TypeError(`Invalid Snake checkpoint ${field}`);
  if (value.score > SCORE_MAX || value.energy < cfg.EnergyMinimum || value.energy > cfg.EnergyMaximum || !Number.isFinite(value.energyDecayGT) || value.energyDecayGT < 0 || value.energyDecayGT > value.runGT || !Number.isFinite(value.nextStepGT) || value.nextStepGT <= value.runGT) throw new TypeError("Invalid Snake checkpoint counters");
  if (typeof value.rngState !== "string" || !/^[0-9a-f]{16}$/i.test(value.rngState)) throw new TypeError("Invalid Snake checkpoint RNG state");
  return Object.freeze({
    runGT: value.runGT,
    snake,
    segmentKinds,
    direction: value.direction,
    growthKinds: Object.freeze([...value.growthKinds]),
    rewards,
    nextRewardSerial: value.nextRewardSerial,
    nextStepGT: value.nextStepGT,
    score: value.score,
    energy: value.energy,
    energyDecayGT: value.energyDecayGT,
    stepCount: value.stepCount,
    pickupCount: value.pickupCount,
    rngState: value.rngState.toLowerCase(),
  });
}

function soundFor(sourceType, resolvedType) {
  if (sourceType === REWARD_MYSTERY) return SNAKE_SOUND_MYSTERY;
  if (resolvedType === REWARD_FORAGE) return SNAKE_SOUND_FORAGE;
  if (resolvedType === REWARD_PREDATION) return SNAKE_SOUND_PREDATION;
  if (resolvedType === REWARD_ANT) return SNAKE_SOUND_ANT;
  if (resolvedType === REWARD_COIN) return SNAKE_SOUND_COIN;
  throw new RangeError("Unknown Snake sound type");
}

function compareItems(left, right) { return left.BN - right.BN || left.sequence - right.sequence; }
function freezeData(value) { return value && typeof value === "object" ? Object.freeze({ ...value }) : value; }
