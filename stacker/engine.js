import { createLogicRng } from "../common/rng.js";
import { STACKER_BOARD_CFG, STACKER_MOTION_CFG, STACKER_SCORE_CFG, STACKER_SHAPES } from "./config.js";

export function createStackerEngine(seed, limitMs) {
  if (!Number.isSafeInteger(limitMs) || limitMs <= 0) throw new RangeError("limitMs must be a positive safe integer");
  const rng = createLogicRng(seed);
  const scale = STACKER_BOARD_CFG.logicScale;
  const baseSize = Math.round(STACKER_BOARD_CFG.baseSize * scale);
  const minMotionSpan = Math.round(STACKER_BOARD_CFG.minMotionSpan * scale);
  const initialSpeed = Math.round(STACKER_MOTION_CFG.initialSpeed * scale);
  const speedStepPerLayer = Math.round(STACKER_MOTION_CFG.speedStepPerLayer * scale);
  let footprint = freezeRect({ x: 0, z: 0, width: baseSize, depth: baseSize });
  let score = 0;
  let speed = initialSpeed;
  let layerCount = 0;
  let ended = false;
  let layers = Object.freeze([]);
  let moving = createMoving(0);

  function randomBelow(bound) {
    const range = 0x1_0000_0000;
    const limit = Math.floor(range / bound) * bound;
    let value;
    do value = rng.nextUint32(); while (value >= limit);
    return value % bound;
  }

  function chooseShape() {
    const total = STACKER_SHAPES.reduce((sum, shape) => sum + shape.weight, 0);
    let choice = randomBelow(total);
    for (const shape of STACKER_SHAPES) {
      if (choice < shape.weight) return shape;
      choice -= shape.weight;
    }
    throw new Error("Shape selection failed");
  }

  function createMoving(startedAtMs) {
    return Object.freeze({
      shape: chooseShape(),
      axis: layerCount % 2 === 0 ? "x" : "z",
      side: randomBelow(2) === 0 ? -1 : 1,
      startedAtMs,
    });
  }

  function getMovingAt(raceTimeMs) {
    const axisLength = moving.axis === "x" ? footprint.width : footprint.depth;
    const span = Math.max(axisLength, minMotionSpan);
    const elapsedMs = Math.max(0, Math.trunc(raceTimeMs) - moving.startedAtMs);
    const distance = Math.floor(speed * elapsedMs / 1000);
    const cycle = span * 4;
    const phase = cycle === 0 ? 0 : distance % cycle;
    const fromLeft = phase <= span * 2 ? -span + phase : span * 3 - phase;
    const offset = moving.side < 0 ? fromLeft : -fromLeft;
    return Object.freeze({
      shapeID: moving.shape.id,
      color: moving.shape.color,
      axis: moving.axis,
      offset,
      x: footprint.x + (moving.axis === "x" ? offset : 0),
      z: footprint.z + (moving.axis === "z" ? offset : 0),
      width: footprint.width,
      depth: footprint.depth,
    });
  }

  function applyDrop(_action, remainMs, raceTimeMs) {
    if (ended || !Number.isSafeInteger(remainMs) || remainMs <= 0 || remainMs > limitMs) {
      return { accepted: false, steps: [], snapshot: getSnapshot() };
    }
    const placed = getMovingAt(raceTimeMs);
    const envelopeIntersection = intersectRects(footprint, placed);
    if (!envelopeIntersection) {
      ended = true;
      return {
        accepted: true,
        endReason: "miss",
        steps: [Object.freeze({ kind: "miss", placed })],
        snapshot: getSnapshot(),
      };
    }
    const nextFootprint = moving.shape.cutsFootprint ? envelopeIntersection : footprint;

    const retentionBP = ratioBasis(nextFootprint.width, nextFootprint.depth, footprint.width, footprint.depth);
    const nextLayer = layerCount + 1;
    const remainTicks = Math.ceil(remainMs / STACKER_SCORE_CFG.timeTickMs);
    const points = Math.floor(retentionBP * nextLayer * remainTicks / STACKER_SCORE_CFG.scoreDivisor);
    const layer = Object.freeze({
      number: nextLayer,
      shapeID: placed.shapeID,
      color: placed.color,
      retentionBP,
      points,
      footprint: freezeRect(nextFootprint),
    });
    footprint = layer.footprint;
    layerCount = nextLayer;
    score = Math.min(STACKER_SCORE_CFG.maxScore, score + points);
    speed += Math.floor(speedStepPerLayer * moving.shape.speedMultiplierPermille / 1000);
    layers = Object.freeze([...layers, layer]);
    moving = createMoving(raceTimeMs);
    return {
      accepted: true,
      steps: [Object.freeze({ kind: "land", layer, placed })],
      snapshot: getSnapshot(),
    };
  }

  function getSnapshot() {
    return Object.freeze({
      score,
      layerCount,
      speed,
      footprint,
      layers,
      moving: Object.freeze({ shapeID: moving.shape.id, axis: moving.axis, side: moving.side, startedAtMs: moving.startedAtMs }),
    });
  }

  function hasLegalMove() { return !ended; }

  return Object.freeze({ applyDrop, getMovingAt, getSnapshot, hasLegalMove });
}

function intersectRects(a, b) {
  const x = Math.max(a.x, b.x);
  const z = Math.max(a.z, b.z);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.z + a.depth, b.z + b.depth);
  if (right <= x || bottom <= z) return null;
  return { x, z, width: right - x, depth: bottom - z };
}

function ratioBasis(newWidth, newDepth, oldWidth, oldDepth) {
  return Number(BigInt(newWidth) * BigInt(newDepth) * BigInt(STACKER_SCORE_CFG.retentionBasis) /
    (BigInt(oldWidth) * BigInt(oldDepth)));
}

function freezeRect(rect) {
  return Object.freeze({ x: rect.x, z: rect.z, width: rect.width, depth: rect.depth });
}
