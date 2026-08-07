import { createMaskMesh } from "./mesh.js";

const MASKS = Object.freeze({
  solid: Object.freeze(["#####", "#####", "#####", "#####", "#####"]),
  frame: Object.freeze(["#####", "#...#", "#...#", "#...#", "#####"]),
  plus: Object.freeze(["..#..", "..#..", "#####", "..#..", "..#.."]),
  x: Object.freeze(["#...#", ".#.#.", "..#..", ".#.#.", "#...#"]),
  diamond: Object.freeze(["..#..", ".###.", "#####", ".###.", "..#.."]),
  diamondRing: Object.freeze(["..#..", ".#.#.", "#...#", ".#.#.", "..#.."]),
  octagon: Object.freeze([".###.", "#####", "#####", "#####", ".###."]),
  star: Object.freeze(["#.#.#", ".###.", "#####", ".###.", "#.#.#"]),
  z: Object.freeze(["#####", "...#.", "..#..", ".#...", "#####"]),
  s: Object.freeze(["#####", ".#...", "..#..", "...#.", "#####"]),
});

const COLORS = Object.freeze({
  solid: "#68dfb2", frame: "#8e86ef", plus: "#ffb15f", x: "#ff7184", diamond: "#5db5fb",
  diamondRing: "#ead85f", octagon: "#65d7d4", star: "#db83ef", z: "#ff8d5f", s: "#82a4ff",
});

export const STACKER_SHAPES = Object.freeze(Object.entries(MASKS).map(([id, mask]) => Object.freeze({
  id,
  mask,
  mesh: createMaskMesh(mask),
  weight: id === "solid" ? 9 : 1,
  color: COLORS[id],
})));

export const cfg = Object.freeze({
  GridSize: 5,
  LogicScale: 1_000_000,
  BaseSize: 6,
  InitialTraverseMS: 1_000,
  MinimumTraverseMS: 200,
  LandingMS: 120,
  RetentionBasis: 10_000,
  ScoreBasisDivisor: 10,
  EnergyInitial: 50,
  EnergyMinimum: 50,
  EnergyMaximum: 400,
  EnergyDecayMS: 100,
  EnergyDecayDelta: 1,
  EnergyChargeDivisor: 30,
  EnergyMultiplierDivisor: 50,
  EnergyGreenThreshold: 100,
  EnergyOrangeThreshold: 200,
  EnergyPurpleThreshold: 400,
  PumpWaitMS: 10,
  RenderWaitMS: 30,
  PerformanceWindowMS: 2_000,
  TPSGreenMin: 80,
  TPSOrangeMin: 50,
  FPSGreenMin: 25,
  FPSOrangeMin: 16,
  LayerHeightPx: 18,
});

export const STACKER_PERFORMANCE_CFG = Object.freeze({
  windowMs: cfg.PerformanceWindowMS,
  refreshMs: 500,
  manualFrames: true,
  roundNearest: true,
  tps: Object.freeze({ warningBelow: cfg.TPSGreenMin, criticalBelow: cfg.TPSOrangeMin }),
  fps: Object.freeze({ warningBelow: cfg.FPSGreenMin, criticalBelow: cfg.FPSOrangeMin }),
});
