export const cfg = Object.freeze({
  InitialLane: 1,            // Initial lane: 0 left, 1 middle, 2 right.

  InitialBlood: 3,           // Initial health, in hearts.
  MaxBlood: 3,               // Maximum health, in hearts.

  NormalSpeed: 100,          // Normal speed basis; 100 means 1.00x.
  InitialSpeed: 100,         // Starting speed; 100 means 1.00x.
  MinSpeed: 50,              // Minimum speed; 50 means 0.50x.
  MaxSpeed: 800,             // Maximum speed; 800 means 8.00x.

  RewardBaseScore: 100,      // Score at 1.00x speed and reward factor 1.

  PrepareMS: 3_000,          // Start/resume countdown duration, in milliseconds.
  SwipeThresholdPx: 28,      // Horizontal swipe threshold, in CSS pixels.

  PumpWaitMS: 10,            // Delay after a completed Pump, in milliseconds.
  RenderWaitMS: 30,          // Delay after a completed Render, in milliseconds.
  PerformanceWindowMS: 2_000,// TPS/FPS sliding window, in milliseconds.
  TPSGreenMin: 80,           // Minimum green TPS, in completed Pumps per second.
  TPSOrangeMin: 50,          // Minimum orange TPS; lower values are red.
  FPSGreenMin: 25,           // Minimum green FPS, in completed Renders per second.
  FPSOrangeMin: 16,          // Minimum orange FPS; lower values are red.

  FirstStationAt: 2,         // First road station, in road-distance units.
  StationGap: 1,             // Fixed gap between stations, in road-distance units.
  DoublePenaltyGap: 3,       // Required ordinary stations between double penalties.

  ViewDistance: 6,           // Visible road ahead, in road-distance units.
  LaneTransitionMS: 160,     // Visual lane interpolation duration, in milliseconds.
});

export const RUNNER_OBJECTS = Object.freeze({
  empty: Object.freeze({
    roadWeight: 40,
    roadType: "empty",
    runSpeedDelta: 0,
    runScoreFactor: 0,
    runBloodDelta: 0,
    svg: null,
  }),
  cone: Object.freeze({
    roadWeight: 15,
    roadType: "penalty",
    runSpeedDelta: 0,
    runScoreFactor: 0,
    runBloodDelta: -1,
    svg: "cone",
  }),
  acceleration: Object.freeze({
    roadWeight: 10,
    roadType: "neutral",
    runSpeedDelta: 50,
    runScoreFactor: 0,
    runBloodDelta: 0,
    svg: "acceleration",
  }),
  deceleration: Object.freeze({
    roadWeight: 10,
    roadType: "neutral",
    runSpeedDelta: -25,
    runScoreFactor: 0,
    runBloodDelta: 0,
    svg: "deceleration",
  }),
  coin: Object.freeze({
    roadWeight: 20,
    roadType: "reward",
    runSpeedDelta: 1,
    runScoreFactor: 1,
    runBloodDelta: 0,
    svg: "coin",
  }),
  diamond: Object.freeze({
    roadWeight: 5,
    roadType: "reward",
    runSpeedDelta: 0,
    runScoreFactor: 5,
    runBloodDelta: 0,
    svg: "diamond",
  }),
});

export const RUNNER_PERFORMANCE_CFG = Object.freeze({
  windowMs: cfg.PerformanceWindowMS,
  refreshMs: 500,
  manualFrames: true,
  roundNearest: true,
  tps: Object.freeze({ warningBelow: cfg.TPSGreenMin, criticalBelow: cfg.TPSOrangeMin }),
  fps: Object.freeze({ warningBelow: cfg.FPSGreenMin, criticalBelow: cfg.FPSOrangeMin }),
});
