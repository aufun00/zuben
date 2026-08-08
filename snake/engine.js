export const REWARD_FORAGE = "forage";
export const REWARD_PREDATION = "predation";
export const REWARD_ANT = "ant";
export const REWARD_MYSTERY = "mystery";
export const REWARD_COIN = "coin";

export const REWARD_TYPES = Object.freeze([
  REWARD_FORAGE,
  REWARD_PREDATION,
  REWARD_ANT,
  REWARD_MYSTERY,
  REWARD_COIN,
]);

const WEIGHTED_TYPES = Object.freeze([
  REWARD_FORAGE, REWARD_FORAGE, REWARD_FORAGE,
  REWARD_PREDATION, REWARD_PREDATION,
  REWARD_ANT,
  REWARD_MYSTERY,
  REWARD_COIN,
]);
const MYSTERY_TYPES = Object.freeze([
  REWARD_FORAGE, REWARD_FORAGE, REWARD_FORAGE,
  REWARD_PREDATION, REWARD_PREDATION,
  REWARD_ANT,
]);
const DIRECTIONS = Object.freeze({
  north: Object.freeze({ row: -1, col: 0 }),
  east: Object.freeze({ row: 0, col: 1 }),
  south: Object.freeze({ row: 1, col: 0 }),
  west: Object.freeze({ row: 0, col: -1 }),
});
const OPPOSITE = Object.freeze({ north: "south", east: "west", south: "north", west: "east" });
const VARIANT_COUNTS = Object.freeze({ forage: 3, predation: 3, ant: 1, mystery: 1, coin: 1 });
const UINT32_RANGE = 0x1_0000_0000;

export function validateSnakeConfig(value) {
  const positive = [
    "BoardColumns", "BoardRows", "InitialLength", "RewardCount", "EdgeBandWidth", "RewardLifetimeMS", "RewardBlinkMS",
    "PrepareMS", "SwipeThresholdPx", "InitialStepMS", "SpeedTierMS", "SpeedStepMS", "MinimumStepMS",
    "EnergyInitial", "EnergyMinimum", "EnergyMaximum", "EnergyPerUnit", "EnergyDecayMS", "EnergyDecayDelta",
    "EnergyGreenThreshold", "EnergyOrangeThreshold", "EnergyPurpleThreshold", "CellScoreBase", "CellEnergyCharge", "ScoreEnergyDivisor",
    "PumpWaitMS", "RenderWaitMS",
  ];
  for (const key of positive) if (!Number.isSafeInteger(value?.[key]) || value[key] <= 0) throw new RangeError(`Invalid Snake config: ${key}`);
  if (value.BoardColumns < 8 || value.BoardRows < 8 || value.InitialLength >= value.BoardColumns - 2) throw new RangeError("Snake board or initial length is invalid");
  if (value.EdgeBandWidth * 2 >= Math.min(value.BoardColumns, value.BoardRows)) throw new RangeError("Snake edge band leaves no center");
  if (value.RewardBlinkMS >= value.RewardLifetimeMS) throw new RangeError("Snake blink duration must be shorter than lifetime");
  if (value.MinimumStepMS > value.InitialStepMS) throw new RangeError("Snake minimum step cannot exceed initial step");
  if (!(value.EnergyMinimum <= value.EnergyInitial && value.EnergyInitial <= value.EnergyMaximum)) throw new RangeError("Snake initial energy is outside its range");
  if (!(value.EnergyGreenThreshold < value.EnergyOrangeThreshold && value.EnergyOrangeThreshold < value.EnergyPurpleThreshold && value.EnergyPurpleThreshold <= value.EnergyMaximum)) throw new RangeError("Snake energy thresholds are invalid");
  return true;
}

export function createInitialSnake(columns, rows, length) {
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || !Number.isSafeInteger(length) || columns < 3 || rows < 3 || length < 2 || length >= columns) throw new RangeError("Invalid initial snake dimensions");
  const row = Math.floor(rows / 2);
  const headColumn = Math.floor(columns / 2) + 1;
  return Object.freeze(Array.from({ length }, (_, offset) => row * columns + headColumn - offset));
}

export function getStepMS(atGT, value) {
  if (!Number.isFinite(atGT) || atGT < 0) throw new RangeError("Snake GT must be nonnegative");
  const tiers = Math.floor(atGT / value.SpeedTierMS);
  return Math.max(value.MinimumStepMS, value.InitialStepMS - tiers * value.SpeedStepMS);
}

export function dominantDirection(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) throw new RangeError("direction requires a finite nonzero vector");
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "west" : "east") : (dy < 0 ? "north" : "south");
}

export function isDirection(value) { return Object.hasOwn(DIRECTIONS, value); }
export function isOpposite(left, right) { return OPPOSITE[left] === right; }

export function nextCell(index, direction, columns, rows) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= columns * rows || !isDirection(direction)) throw new RangeError("Invalid Snake movement");
  const row = Math.floor(index / columns) + DIRECTIONS[direction].row;
  const col = index % columns + DIRECTIONS[direction].col;
  if (row < 0 || row >= rows || col < 0 || col >= columns) return -1;
  return row * columns + col;
}

export function drawRewardType(rng) { return WEIGHTED_TYPES[nextBounded(rng, WEIGHTED_TYPES.length)]; }
export function drawMysteryType(rng) { return MYSTERY_TYPES[nextBounded(rng, MYSTERY_TYPES.length)]; }

export function rewardEffect(type) {
  if (type === REWARD_FORAGE) return Object.freeze({ growth: 1, scoreUnits: 10, energyUnits: 1, segmentKind: "snake" });
  if (type === REWARD_PREDATION) return Object.freeze({ growth: 3, scoreUnits: 30, energyUnits: 3, segmentKind: "snake" });
  if (type === REWARD_ANT) return Object.freeze({ growth: 1, scoreUnits: 0, energyUnits: 0, segmentKind: "ant" });
  if (type === REWARD_COIN) return Object.freeze({ growth: 0, scoreUnits: 50, energyUnits: 5, segmentKind: null });
  throw new RangeError("Mystery must be resolved before applying its reward effect");
}

export function createReward({ type, index, bornGT, serial, lifetimeMS }) {
  if (!REWARD_TYPES.includes(type) || !Number.isSafeInteger(index) || index < 0 || !Number.isFinite(bornGT) || bornGT < 0 || !Number.isSafeInteger(serial) || serial < 0) throw new TypeError("Invalid Snake reward");
  const variants = VARIANT_COUNTS[type];
  return Object.freeze({ id: serial, type, index, bornGT, expiresGT: bornGT + lifetimeMS, variant: serial % variants });
}

export function chooseRewardCell({ type, columns, rows, edgeWidth, occupied, rng }) {
  const preferred = [];
  const fallback = [];
  for (let index = 0; index < columns * rows; index += 1) {
    if (occupied.has(index)) continue;
    fallback.push(index);
    const row = Math.floor(index / columns), col = index % columns;
    const edge = row < edgeWidth || row >= rows - edgeWidth || col < edgeWidth || col >= columns - edgeWidth;
    if ((type === REWARD_COIN) === edge) preferred.push(index);
  }
  const candidates = preferred.length > 0 ? preferred : fallback;
  return candidates.length > 0 ? candidates[nextBounded(rng, candidates.length)] : -1;
}

export function nextBounded(rng, bound) {
  if (!Number.isSafeInteger(bound) || bound <= 0 || bound > UINT32_RANGE || typeof rng?.nextUint32 !== "function") throw new RangeError("bound must be an integer from 1 to 2^32");
  const limit = Math.floor(UINT32_RANGE / bound) * bound;
  let value;
  do value = rng.nextUint32(); while (value >= limit);
  return value % bound;
}

export function validateSnakeState({ snake, segmentKinds, rewards, columns, rows }) {
  if (!Array.isArray(snake) || snake.length < 2 || !Array.isArray(segmentKinds) || segmentKinds.length !== snake.length) throw new TypeError("Invalid Snake body");
  const occupied = new Set();
  for (const index of snake) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= columns * rows || occupied.has(index)) throw new TypeError("Invalid Snake body cell");
    occupied.add(index);
  }
  if (segmentKinds.some((kind) => kind !== "snake" && kind !== "ant")) throw new TypeError("Invalid Snake segment kind");
  for (const reward of rewards) {
    if (!reward || !REWARD_TYPES.includes(reward.type) || !Number.isSafeInteger(reward.index) || reward.index < 0 || reward.index >= columns * rows || occupied.has(reward.index) || occupied.has(`reward:${reward.index}`)) throw new TypeError("Invalid Snake reward state");
    occupied.add(`reward:${reward.index}`);
  }
  return true;
}
