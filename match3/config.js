export const TILE_CATALOG = Object.freeze([
  Object.freeze({ symbol: "piece-0" }),
  Object.freeze({ symbol: "piece-1" }),
  Object.freeze({ symbol: "piece-2" }),
  Object.freeze({ symbol: "piece-3" }),
  Object.freeze({ symbol: "piece-4" }),
  Object.freeze({ symbol: "piece-5" }),
]);

export const EFFECT_NONE = 0;
export const EFFECT_A = 1;
export const EFFECT_B = 2;
export const EFFECT_C = 3;
export const EFFECT_D = 4;
export const EFFECT_PRIORITY = Object.freeze([EFFECT_D, EFFECT_C, EFFECT_B, EFFECT_A]);

export const cfg = Object.freeze({
  BoardSize: 8,
  TileTypeCount: 6,
  TileWeights: Object.freeze([1, 1, 1, 1, 1, 1]),
  MysteryNumerator: 1,
  MysteryDenominator: 20,
  EffectWeights: Object.freeze([1, 1, 1, 1]),

  PrepareMS: 0,
  SwipeThresholdPx: 28,
  SwapMS: 90,
  SwapBackMS: 100,
  ClearMS: 140,
  FallMS: 140,

  EnergyInitial: 50,
  EnergyPerCell: 5,
  EnergyDecayMS: 100,
  EnergyDecayDelta: 1,
  EnergyGreenThreshold: 100,
  EnergyOrangeThreshold: 200,
  EnergyPurpleThreshold: 400,
  ScoreEnergyDivisor: 50,

  PumpWaitMS: 10,
  RenderWaitMS: 32,
  PerformanceWindowMS: 2_000,
  TPSGreenMin: 80,
  TPSOrangeMin: 50,
  FPSGreenMin: 25,
  FPSOrangeMin: 16,
});

export const MATCH3_PERFORMANCE_CFG = Object.freeze({
  windowMs: cfg.PerformanceWindowMS,
  refreshMs: 500,
  manualFrames: true,
  roundNearest: true,
  tps: Object.freeze({ warningBelow: cfg.TPSGreenMin, criticalBelow: cfg.TPSOrangeMin }),
  fps: Object.freeze({ warningBelow: cfg.FPSGreenMin, criticalBelow: cfg.FPSOrangeMin }),
});
