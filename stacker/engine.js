import { SCORE_MAX } from "../common/protocol-constants.js";
import { createLogicRng } from "../common/rng.js";
import { STACKER_SHAPES, cfg as defaultCfg } from "./config.js";

const UINT32_RANGE = 0x1_0000_0000;

export function createStackerEngine({ seed, cfg = defaultCfg, shapes = STACKER_SHAPES, checkpoint = null } = {}) {
  validateStackerConfig(cfg, shapes);
  if (!(seed instanceof Uint8Array) || seed.length !== 6) throw new TypeError("seed must be a 6-byte Uint8Array");

  const restored = checkpoint === null ? null : normalizeCheckpoint(checkpoint, cfg, shapes);
  const rng = createLogicRng(seed, restored?.rngState ?? null);
  const baseSpan = cfg.BaseSize * cfg.LogicScale;
  let footprint = restored?.footprint ?? freezeRect({ x: 0, z: 0, width: baseSpan, depth: baseSpan });
  let layers = restored?.layers ?? Object.freeze([]);
  let layerCount = restored?.layerCount ?? 0;
  let score = restored?.score ?? 0;
  let moving = restored?.moving ?? generateMoving(0);

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

  function drop(actionGT, scoreEnergy = cfg.EnergyMinimum) {
    if (!Number.isFinite(actionGT) || actionGT < 0) throw new RangeError("actionGT must be nonnegative and finite");
    if (!Number.isSafeInteger(scoreEnergy) || scoreEnergy < cfg.EnergyMinimum || scoreEnergy > cfg.EnergyMaximum) throw new RangeError("scoreEnergy is outside the Stacker energy range");
    const placed = movingAt(actionGT);
    const intersection = intersectRects(footprint, placed);
    if (!intersection) return Object.freeze({ kind: "miss", placed });

    const previousArea = BigInt(footprint.width) * BigInt(footprint.depth);
    const nextFootprint = freezeRect(intersection);
    const nextArea = BigInt(nextFootprint.width) * BigInt(nextFootprint.depth);
    const retentionBP = Number(nextArea * BigInt(cfg.RetentionBasis) / previousArea);
    const baseScore = Math.floor(retentionBP / cfg.ScoreBasisDivisor);
    const multipliedPoints = Number(BigInt(baseScore) * BigInt(scoreEnergy) / BigInt(cfg.EnergyMultiplierDivisor));
    const points = Math.min(multipliedPoints, SCORE_MAX - score);
    const layer = Object.freeze({
      number: layerCount + 1,
      shapeID: placed.shapeID,
      color: placed.color,
      retentionBP,
      baseScore,
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

  function exportCheckpoint() {
    return Object.freeze({
      version: 1,
      footprint,
      layers,
      layerCount,
      score,
      moving,
      rngState: rng.exportState(),
    });
  }

  return Object.freeze({ movingAt, drop, snapshot, exportCheckpoint });
}

export function calculateTraverseMS(axisLength, cfg = defaultCfg) {
  if (!Number.isSafeInteger(axisLength) || axisLength <= 0) throw new RangeError("axisLength must be a positive safe integer");
  const baseSpan = cfg.BaseSize * cfg.LogicScale;
  return cfg.MinimumTraverseMS + Math.floor((cfg.InitialTraverseMS - cfg.MinimumTraverseMS) * axisLength / baseSpan);
}

export function validateStackerConfig(cfg, shapes = STACKER_SHAPES) {
  for (const key of ["GridSize", "LogicScale", "BaseSize", "InitialTraverseMS", "MinimumTraverseMS", "LandingMS", "RetentionBasis", "ScoreBasisDivisor", "EnergyInitial", "EnergyMinimum", "EnergyMaximum", "EnergyDecayMS", "EnergyDecayDelta", "EnergyChargeDivisor", "EnergyMultiplierDivisor", "EnergyGreenThreshold", "EnergyOrangeThreshold", "EnergyPurpleThreshold", "PumpWaitMS", "RenderWaitMS", "LayerHeightPx"]) {
    if (!Number.isSafeInteger(cfg[key]) || cfg[key] <= 0) throw new RangeError(`${key} must be a positive safe integer`);
  }
  if (cfg.MinimumTraverseMS > cfg.InitialTraverseMS) throw new RangeError("MinimumTraverseMS must not exceed InitialTraverseMS");
  if (!(cfg.EnergyMinimum <= cfg.EnergyInitial && cfg.EnergyInitial <= cfg.EnergyMaximum)) throw new RangeError("Stacker initial energy must be within its energy range");
  if (!(cfg.EnergyGreenThreshold < cfg.EnergyOrangeThreshold && cfg.EnergyOrangeThreshold < cfg.EnergyPurpleThreshold && cfg.EnergyPurpleThreshold <= cfg.EnergyMaximum)) throw new RangeError("Invalid Stacker energy thresholds");
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

function normalizeCheckpoint(value, cfg, shapes) {
  if (!value || typeof value !== "object" || value.version !== 1) throw new TypeError("Invalid Stacker engine checkpoint");
  const shapeByID = new Map(shapes.map((shape) => [shape.id, shape]));
  const footprint = normalizeRect(value.footprint);
  if (!Array.isArray(value.layers) || !Number.isSafeInteger(value.layerCount) || value.layerCount < 0 || value.layers.length !== value.layerCount) throw new TypeError("Invalid Stacker checkpoint layers");
  const layers = Object.freeze(value.layers.map((layer, index) => {
    if (!layer || typeof layer !== "object" || layer.number !== index + 1 || !shapeByID.has(layer.shapeID)) throw new TypeError("Invalid Stacker checkpoint layer");
    if (!Number.isSafeInteger(layer.retentionBP) || layer.retentionBP < 0 || layer.retentionBP > cfg.RetentionBasis) throw new TypeError("Invalid Stacker checkpoint retention");
    const baseScore = Math.floor(layer.retentionBP / cfg.ScoreBasisDivisor);
    if (layer.baseScore !== baseScore) throw new TypeError("Invalid Stacker checkpoint base score");
    if (!Number.isSafeInteger(layer.points) || layer.points < 0 || layer.points > SCORE_MAX) throw new TypeError("Invalid Stacker checkpoint points");
    return Object.freeze({
      number: layer.number,
      shapeID: layer.shapeID,
      color: shapeByID.get(layer.shapeID).color,
      retentionBP: layer.retentionBP,
      baseScore,
      points: layer.points,
      footprint: normalizeRect(layer.footprint),
    });
  }));
  const score = layers.reduce((sum, layer) => Math.min(SCORE_MAX, sum + layer.points), 0);
  if (value.score !== score) throw new TypeError("Invalid Stacker checkpoint score");
  const movingShape = value.moving && shapeByID.get(value.moving.shapeID);
  if (!movingShape || !["x", "z"].includes(value.moving.axis) || ![-1, 1].includes(value.moving.side) || !Number.isFinite(value.moving.startGT) || value.moving.startGT < 0) throw new TypeError("Invalid Stacker checkpoint moving layer");
  if (typeof value.rngState !== "string" || !/^[0-9a-f]{16}$/i.test(value.rngState)) throw new TypeError("Invalid Stacker checkpoint RNG state");
  return Object.freeze({
    footprint,
    layers,
    layerCount: value.layerCount,
    score,
    moving: Object.freeze({ shapeID: movingShape.id, color: movingShape.color, axis: value.moving.axis, side: value.moving.side, startGT: value.moving.startGT }),
    rngState: value.rngState.toLowerCase(),
  });
}

function normalizeRect(value) {
  if (!value || typeof value !== "object") throw new TypeError("Invalid Stacker checkpoint rectangle");
  const rect = { x: value.x, z: value.z, width: value.width, depth: value.depth };
  if (![rect.x, rect.z, rect.width, rect.depth].every(Number.isSafeInteger) || rect.width <= 0 || rect.depth <= 0) throw new TypeError("Invalid Stacker checkpoint rectangle");
  return freezeRect(rect);
}
