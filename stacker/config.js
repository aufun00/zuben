import { GAME_FLOW_CFG } from "../common/game-flow-config.js";
import { SCORE_MAX } from "../common/protocol-constants.js";
import { createMaskMesh } from "./mesh.js";

const masks = {
  solid: ["#####", "#####", "#####", "#####", "#####"],
  frame: ["#####", "#...#", "#...#", "#...#", "#####"],
  plus: ["..#..", "..#..", "#####", "..#..", "..#.."],
  x: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  diamond: ["..#..", ".###.", "#####", ".###.", "..#.."],
  diamondRing: ["..#..", ".#.#.", "#...#", ".#.#.", "..#.."],
  octagon: [".###.", "#####", "#####", "#####", ".###."],
  star: ["#.#.#", ".###.", "#####", ".###.", "#.#.#"],
  z: ["#####", "...#.", "..#..", ".#...", "#####"],
  s: ["#####", ".#...", "..#..", "...#.", "#####"],
};

const colors = {
  solid: "#68dfb2", frame: "#8e86ef", plus: "#ffb15f", x: "#ff7184", diamond: "#5db5fb",
  diamondRing: "#ead85f", octagon: "#65d7d4", star: "#db83ef", z: "#ff8d5f", s: "#82a4ff",
};

export const STACKER_SHAPES = Object.freeze(Object.entries(masks).map(([id, mask]) => Object.freeze({
  id,
  mask: Object.freeze(mask),
  mesh: createMaskMesh(mask),
  weight: id === "solid" ? Object.keys(masks).length - 1 : 1,
  cutsFootprint: true,
  color: colors[id],
})));

export const STACKER_BOARD_CFG = Object.freeze({
  gridSize: 5,
  logicScale: 1_000_000,
  baseSize: 6,
});

export const STACKER_MOTION_CFG = Object.freeze({
  initialTraverseMs: 1_000,
  minimumTraverseMs: 200,
  // Gameplay cooldown and visual landing duration share this authority. The next brick starts afterwards.
  landingMs: 120,
});

export const STACKER_SCORE_CFG = Object.freeze({
  retentionBasis: 10_000,
  scoreBase: 10_000,
  retentionExponent: 1,
  maxScore: SCORE_MAX,
});

export const STACKER_ANIMATION_CFG = Object.freeze({ landMs: STACKER_MOTION_CFG.landingMs });

export const STACKER_RENDER_CFG = Object.freeze({ layerHeightPx: 18 });

export const STACKER_FLOW_CFG = Object.freeze({
  ...GAME_FLOW_CFG,
  prepareCount: 0,
  prepareStepMs: 0,
});
