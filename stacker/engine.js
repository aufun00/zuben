import { SCORE_MAX } from "../common/protocol-constants.js";
import { createLogicRng } from "../common/rng.js";
import { STACKER_SHAPES, cfg as defaultCfg } from "./config.js";

const UINT32_RANGE = 0x1_0000_0000;

export function createStackerEngine({ seed, cfg = defaultCfg, shapes = STACKER_SHAPES } = {}) {
  validateStackerConfig(cfg, shapes);
  if (!(seed instanceof Uint8Array) || seed.length !== 6) throw new TypeError("seed must be a 6-byte Uint8Array");

  const rng = createLogicRng(seed);
  const baseSpan = cfg.BaseSize * cfg.LogicScale;
  let footprint = freezeRect({ x: 0, z: 0, width: baseSpan, depth: baseSpan });
  let layers = Object.freeze([]);
  let layerCount = 0;
  let score = 0;
  let moving = generateMoving(0);

  function nextBounded(bound) {
    const ceiling = Math.floor(UINT32_RANGE / bound) * bound;
    let value;
    do value = rng.nextUint32(); while (value >= ceiling);
    return value % bound;
  }

  function generateMoving(startGT) {
    const totalWeight = shapes.reduce((sum, shape) => sum + shape.weight, 0);
    let pick = nextBounded(totalWeight);
    let shape = null;
    for (const candidate of shapes) {
      if (pick < candidate.weight) { shape = candidate; break; }
      pick -= candidate.weight;
    }
    if (!shape) throw new Error("shape selection failed");
    return Object.freeze({
      shapeID: shape.id,
      color: shape.color,
      axis: layerCount % 2 === 0 ? "x" : "z",
      side: nextBounded(2) === 0 ? -1 : 1,
      startGT,
    });
  }

  function movingAt(runGT) {
    if (!Number.isFinite(runGT)) throw new TypeError("runGT must be finite");
    const axisLength = moving.axis === "x" ? footprint.width : footprint.depth;
    const traverseMS = calculateTraverseMS(axisLength, cfg);
    const elapsedMS = Math.max(0, Math.floor(runGT - moving.startGT));
    const distance = Math.floor(baseSpan * 2 * elapsedMS / traverseMS);
    const cycle = baseSpan * 4;
    const phase = distance % cycle;
    const fromNegative = phase <= baseSpan * 2 ? -baseSpan + phase : baseSpan * 3 - phase;
    const directedOffset = moving.side < 0 ? fromNegative : -fromNegative;
    const offset = directedOffset === 0 ? 0 : directedOffset;
    return Object.freeze({
      ...moving,
      offset,
      x: footprint.x + (moving.axis === "x" ? offset : 0),
      z: footprint.z + (moving.axis === "z" ? offset : 0),
      width: footprint.width,
      depth: footprint.depth,
      traverseMS,
    });
  }

  function drop(actionGT) {
    if (!Number.isFinite(actionGT) || actionGT < 0) throw new RangeError("actionGT must be nonnegative and finite");
    const placed = movingAt(actionGT);
    const intersection = intersectRects(footprint, placed);
    if (!intersection) return Object.freeze({ kind: "miss", placed });

    const previousArea = BigInt(footprint.width) * BigInt(footprint.depth);
    const nextFootprint = freezeRect(intersection);
    const nextArea = BigInt(nextFootprint.width) * BigInt(nextFootprint.depth);
    const retentionBP = Number(nextArea * BigInt(cfg.RetentionBasis) / previousArea);
    const points = Math.min(retentionBP, SCORE_MAX - score);
    const layer = Object.freeze({
      number: layerCount + 1,
      shapeID: placed.shapeID,
      color: placed.color,
      retentionBP,
      points,
      footprint: nextFootprint,
    });
    footprint = nextFootprint;
    layerCount += 1;
    score += points;
    layers = Object.freeze([...layers, layer]);
    moving = generateMoving(actionGT + cfg.LandingMS);
    return Object.freeze({ kind: "land", placed, layer });
  }

  function snapshot() {
    return Object.freeze({ footprint, layers, layerCount, score, moving });
  }

  return Object.freeze({ movingAt, drop, snapshot });
}

export function calculateTraverseMS(axisLength, cfg = defaultCfg) {
  if (!Number.isSafeInteger(axisLength) || axisLength <= 0) throw new RangeError("axisLength must be a positive safe integer");
  const baseSpan = cfg.BaseSize * cfg.LogicScale;
  return cfg.MinimumTraverseMS + Math.floor((cfg.InitialTraverseMS - cfg.MinimumTraverseMS) * axisLength / baseSpan);
}

export function validateStackerConfig(cfg, shapes = STACKER_SHAPES) {
  for (const key of ["GridSize", "LogicScale", "BaseSize", "InitialTraverseMS", "MinimumTraverseMS", "LandingMS", "RetentionBasis", "PumpWaitMS", "RenderWaitMS", "LayerHeightPx"]) {
    if (!Number.isSafeInteger(cfg[key]) || cfg[key] <= 0) throw new RangeError(`${key} must be a positive safe integer`);
  }
  if (cfg.MinimumTraverseMS > cfg.InitialTraverseMS) throw new RangeError("MinimumTraverseMS must not exceed InitialTraverseMS");
  if (!Array.isArray(shapes) || shapes.length !== 10) throw new RangeError("Stacker requires ten shapes");
  const ids = new Set();
  for (const shape of shapes) {
    if (!shape || typeof shape.id !== "string" || ids.has(shape.id)) throw new TypeError("shape IDs must be unique strings");
    ids.add(shape.id);
    if (!Number.isSafeInteger(shape.weight) || shape.weight <= 0) throw new RangeError("shape weight must be positive");
    if (!Array.isArray(shape.mask) || shape.mask.length !== cfg.GridSize || shape.mask.some((row) => typeof row !== "string" || row.length !== cfg.GridSize || !/^[.#]+$/.test(row))) throw new TypeError("shape mask must match GridSize");
  }
}

function intersectRects(left, right) {
  const x = Math.max(left.x, right.x);
  const z = Math.max(left.z, right.z);
  const edgeX = Math.min(left.x + left.width, right.x + right.width);
  const edgeZ = Math.min(left.z + left.depth, right.z + right.depth);
  if (edgeX <= x || edgeZ <= z) return null;
  return { x, z, width: edgeX - x, depth: edgeZ - z };
}

function freezeRect(rect) {
  return Object.freeze({ x: rect.x, z: rect.z, width: rect.width, depth: rect.depth });
}
