export const MATCH3_BOARD_CFG = Object.freeze({
  width: 8,
  height: 8,
  colorCount: 6,
  bagCopiesPerColor: 6,
});

export const MATCH3_SCORE_CFG = Object.freeze({
  timeDivisorMs: 200,
  maxScore: 9_999_999,
});

export const MATCH3_ANIMATION_CFG = Object.freeze({
  swapMs: 120,
  swapBackMs: 140,
  clearMs: 180,
  fallMs: 190,
});

export const MATCH3_FLOW_CFG = Object.freeze({
  ...GAME_FLOW_CFG,
  prepareCount: 0,
  prepareStepMs: 0,
});
import { GAME_FLOW_CFG } from "../common/game-flow-config.js";
