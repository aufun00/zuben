function shape(id, rows) {
  const matrix = rows.map((row) => Object.freeze([...row].map(Number)));
  const cells = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let column = 0; column < matrix[row].length; column += 1) {
      if (matrix[row][column] === 1) cells.push(Object.freeze({ row, column }));
    }
  }
  return Object.freeze({
    id,
    matrix: Object.freeze(matrix),
    cells: Object.freeze(cells),
    height: matrix.length,
    width: matrix[0].length,
    cellCount: cells.length,
  });
}

export const LINEFIT_SHAPES = Object.freeze([
  shape("dot", [[1]]),
  shape("line2H", [[1, 1]]),
  shape("line2V", [[1], [1]]),
  shape("line3H", [[1, 1, 1]]),
  shape("line3V", [[1], [1], [1]]),
  shape("line4H", [[1, 1, 1, 1]]),
  shape("line4V", [[1], [1], [1], [1]]),
  shape("line5H", [[1, 1, 1, 1, 1]]),
  shape("line5V", [[1], [1], [1], [1], [1]]),
  shape("square2", [[1, 1], [1, 1]]),
  shape("square3", [[1, 1, 1], [1, 1, 1], [1, 1, 1]]),
  shape("smallNW", [[1, 1], [1, 0]]),
  shape("smallNE", [[1, 1], [0, 1]]),
  shape("smallSW", [[1, 0], [1, 1]]),
  shape("smallSE", [[0, 1], [1, 1]]),
  shape("largeNW", [[1, 1, 1], [1, 0, 0], [1, 0, 0]]),
  shape("largeNE", [[1, 1, 1], [0, 0, 1], [0, 0, 1]]),
  shape("largeSW", [[1, 0, 0], [1, 0, 0], [1, 1, 1]]),
  shape("largeSE", [[0, 0, 1], [0, 0, 1], [1, 1, 1]]),
]);

export const cfg = Object.freeze({
  BoardSize: 7,                // Square board side length.
  TraySize: 3,                 // A full batch always contains three pieces.
  TrayGridSize: 5,             // Each preview is aligned in a fixed 5x5 slot.
  PrepareMS: 0,                // Weak-operation game: start and resume immediately.
  ClearMS: 300,                // Input-locking visual clear transition.
  DragThresholdPx: 4,          // Movement before a pointer session becomes a drag.
  DragLiftCells: 1.15,         // Full-size piece floats this many cells above the pointer.

  PlaceScorePerCell: 1,
  LineScoreMultiplier: 10,

  EnergyInitial: 50,
  EnergyPerCell: 10,
  EnergyDecayMS: 200,
  EnergyDecayDelta: 1,
  EnergyMultiplierDivisor: 50,
  EnergyMultiplierMinimum: 1,
  EnergyGreenThreshold: 100,
  EnergyOrangeThreshold: 200,
  EnergyPurpleThreshold: 400,
  PumpWaitMS: 10,
  RenderWaitMS: 32,
  PerformanceWindowMS: 2_000,
  TPSGreenMin: 80,
  TPSOrangeMin: 50,
  FPSGreenMin: 25,
  FPSOrangeMin: 16,
});

export const LINEFIT_PERFORMANCE_CFG = Object.freeze({
  windowMs: cfg.PerformanceWindowMS,
  refreshMs: 500,
  manualFrames: true,
  roundNearest: true,
  tps: Object.freeze({ warningBelow: cfg.TPSGreenMin, criticalBelow: cfg.TPSOrangeMin }),
  fps: Object.freeze({ warningBelow: cfg.FPSGreenMin, criticalBelow: cfg.FPSOrangeMin }),
});
