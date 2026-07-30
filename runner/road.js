import { createLogicRng } from "../common/rng.js";

const ROAD_TYPES = new Set(["empty", "penalty", "neutral", "reward"]);
const UINT32_RANGE = 0x1_0000_0000;

export function validateRunnerData(cfg, objects, svg) {
  if (!Number.isInteger(cfg.InitialLane) || cfg.InitialLane < 0 || cfg.InitialLane > 2) fail("InitialLane");
  if (!positiveInteger(cfg.InitialBlood) || !positiveInteger(cfg.MaxBlood) || cfg.InitialBlood > cfg.MaxBlood) fail("blood");
  if (!positiveInteger(cfg.NormalSpeed) || !positiveInteger(cfg.MinSpeed) || !positiveInteger(cfg.InitialSpeed) ||
      !positiveInteger(cfg.MaxSpeed) || cfg.MinSpeed > cfg.InitialSpeed || cfg.InitialSpeed > cfg.MaxSpeed) fail("speed");
  for (const name of ["RewardBaseScore", "PrepareMS", "SwipeThresholdPx", "PumpWaitMS", "RenderWaitMS",
    "PerformanceWindowMS", "FirstStationAt", "StationGap", "ViewDistance", "LaneTransitionMS"]) {
    if (!Number.isFinite(cfg[name]) || cfg[name] <= 0) fail(name);
  }
  if (!Number.isInteger(cfg.DoublePenaltyGap) || cfg.DoublePenaltyGap < 0) fail("DoublePenaltyGap");
  if (!objects || typeof objects !== "object" || !objects.empty) fail("objects");

  for (const [key, object] of Object.entries(objects)) {
    if (!Number.isSafeInteger(object.roadWeight) || object.roadWeight < 0) fail(`${key}.roadWeight`);
    if (!ROAD_TYPES.has(object.roadType)) fail(`${key}.roadType`);
    for (const field of ["runSpeedDelta", "runScoreFactor", "runBloodDelta"]) {
      if (!Number.isSafeInteger(object[field])) fail(`${key}.${field}`);
    }
    if (key === "empty") {
      if (object.roadType !== "empty" || object.svg !== null) fail("empty");
    } else if (typeof object.svg !== "string" || !svg[object.svg]) {
      fail(`${key}.svg`);
    }
  }

  const patterns = createPatternCatalog(objects);
  if (!patterns.ordinary.length || !patterns.withDoublePenalty.length) fail("patterns");
  return true;
}

export function createPatternCatalog(objects) {
  const entries = Object.entries(objects).filter(([, object]) => object.roadWeight > 0);
  const ordinary = [];
  const withDoublePenalty = [];
  for (const left of entries) for (const middle of entries) for (const right of entries) {
    const choices = [left, middle, right];
    if (!choices.some(([, object]) => object.roadType === "empty" || object.roadType === "reward")) continue;
    const penaltyCount = choices.filter(([, object]) => object.roadType === "penalty").length;
    const weight = choices.reduce((product, [, object]) => product * object.roadWeight, 1);
    if (!Number.isSafeInteger(weight) || weight <= 0) fail("pattern weight");
    const pattern = Object.freeze({
      lanes: Object.freeze(choices.map(([key]) => key === "empty" ? null : key)),
      weight,
      doublePenalty: penaltyCount === 2,
    });
    withDoublePenalty.push(pattern);
    if (!pattern.doublePenalty) ordinary.push(pattern);
  }
  validatePatternTotal(ordinary);
  validatePatternTotal(withDoublePenalty);
  return Object.freeze({ ordinary: Object.freeze(ordinary), withDoublePenalty: Object.freeze(withDoublePenalty) });
}

export function generateRoad({ seed, limitMS, cfg, objects, svg }) {
  validateRunnerData(cfg, objects, svg);
  if (!(seed instanceof Uint8Array) || seed.length !== 6) throw new TypeError("seed must be a 6-byte Uint8Array");
  if (!Number.isFinite(limitMS) || limitMS < 0) throw new RangeError("limitMS must be nonnegative");
  const rng = createLogicRng(seed);
  const patterns = createPatternCatalog(objects);
  const roadMaxDistance = cfg.MaxSpeed / cfg.NormalSpeed * limitMS / 1_000;
  const count = roadMaxDistance < cfg.FirstStationAt
    ? 0
    : Math.floor((roadMaxDistance - cfg.FirstStationAt) / cfg.StationGap + Number.EPSILON) + 1;
  const road = [];
  let ordinarySinceDouble = cfg.DoublePenaltyGap;
  for (let index = 0; index < count; index += 1) {
    const pool = ordinarySinceDouble >= cfg.DoublePenaltyGap ? patterns.withDoublePenalty : patterns.ordinary;
    const pattern = selectWeightedPattern(rng, pool);
    road.push(Object.freeze({
      at: cfg.FirstStationAt + index * cfg.StationGap,
      lanes: pattern.lanes,
    }));
    ordinarySinceDouble = pattern.doublePenalty ? 0 : ordinarySinceDouble + 1;
  }
  validateRoad(road, cfg, objects, roadMaxDistance);
  return Object.freeze(road);
}

export function validateRoad(road, cfg, objects, roadMaxDistance = Infinity) {
  if (!Array.isArray(road)) fail("road");
  let lastAt = -Infinity;
  let lastDouble = -Infinity;
  for (let index = 0; index < road.length; index += 1) {
    const station = road[index];
    if (!Number.isFinite(station.at) || station.at <= lastAt || station.at > roadMaxDistance) fail("road.at");
    if (!Array.isArray(station.lanes) || station.lanes.length !== 3) fail("road.lanes");
    const laneObjects = station.lanes.map((key) => key === null ? null : objects[key]);
    if (laneObjects.some((object, lane) => station.lanes[lane] !== null && !object)) fail("road key");
    if (!laneObjects.some((object) => object === null || object.roadType === "reward")) fail("blocked station");
    const doublePenalty = laneObjects.filter((object) => object?.roadType === "penalty").length === 2;
    if (doublePenalty && index - lastDouble - 1 < cfg.DoublePenaltyGap) fail("double penalty gap");
    if (doublePenalty) lastDouble = index;
    lastAt = station.at;
  }
  return true;
}

export function nextBounded(rng, bound) {
  if (!Number.isSafeInteger(bound) || bound <= 0 || bound > UINT32_RANGE) throw new RangeError("bound must be an integer from 1 to 2^32");
  const limit = Math.floor(UINT32_RANGE / bound) * bound;
  let value;
  do value = rng.nextUint32(); while (value >= limit);
  return value % bound;
}

function selectWeightedPattern(rng, patterns) {
  const total = patterns.reduce((sum, pattern) => sum + pattern.weight, 0);
  let selection = nextBounded(rng, total);
  for (const pattern of patterns) {
    if (selection < pattern.weight) return pattern;
    selection -= pattern.weight;
  }
  throw new Error("weighted selection failed");
}

function validatePatternTotal(patterns) {
  const total = patterns.reduce((sum, pattern) => sum + pattern.weight, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total > UINT32_RANGE) fail("pattern total");
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function fail(field) {
  throw new RangeError(`Invalid Runner data: ${field}`);
}
