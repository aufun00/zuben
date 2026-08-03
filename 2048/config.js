export const cfg = Object.freeze({
  BoardSize: 5,           // Square board side length; 5 means a 5x5 board.
  InitialTileCount: 2,    // Tiles generated before READY.
  SpawnTileCount: 1,      // Tiles generated after each valid move.
  SpawnTwoWeight: 9,      // Relative probability weight for a new 2 tile.
  SpawnFourWeight: 1,     // Relative probability weight for a new 4 tile.

  PrepareMS: 0,           // No visible countdown; retain the StartGame queue boundary.
  SwipeThresholdPx: 28,   // Immediate four-way swipe threshold, in CSS pixels.
  MoveMS: 140,            // Input-locking move transition duration, in milliseconds.

  EnergyInitial: 50,           // Starting energy before GameTime begins.
  EnergyChargeMultiplier: 2,  // Merged-value sum is multiplied by this amount when charging.
  EnergyDecayMS: 100,          // Energy settles in deterministic GameTime steps.
  EnergyDecayDelta: 1,         // Energy lost at each decay step.
  EnergyGreenThreshold: 100,   // Reaching this energy enables the green score tier.
  EnergyOrangeThreshold: 200,  // Reaching this energy enables the orange score tier.
  EnergyPurpleThreshold: 400,  // Reaching this energy enables the purple score tier.
  ScoreEnergyDivisor: 5,       // Score factor is charged energy divided by this value.

  PumpWaitMS: 10,         // Delay before the next one-shot Pump, in milliseconds.
  RenderWaitMS: 32,       // Non-harmonic delay avoids repeated alignment with the 10ms Pump.
  PerformanceWindowMS: 2_000,
  TPSGreenMin: 80,
  TPSOrangeMin: 50,
  FPSGreenMin: 25,
  FPSOrangeMin: 16,
});

export const TWENTY48_PERFORMANCE_CFG = Object.freeze({
  windowMs: cfg.PerformanceWindowMS,
  refreshMs: 500,
  manualFrames: true,
  roundNearest: true,
  tps: Object.freeze({ warningBelow: cfg.TPSGreenMin, criticalBelow: cfg.TPSOrangeMin }),
  fps: Object.freeze({ warningBelow: cfg.FPSGreenMin, criticalBelow: cfg.FPSOrangeMin }),
});
