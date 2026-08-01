import { SCORE_MAX } from "../common/protocol-constants.js";

export function createEnergy(cfg) {
  validateEnergyConfig(cfg);
  let energy = cfg.EnergyInitial;
  let settledGT = 0;

  function advanceTo(targetGT) {
    if (!Number.isFinite(targetGT) || targetGT < settledGT) throw new RangeError("energy targetGT must be monotonic");
    const ticks = Math.floor((targetGT - settledGT) / cfg.EnergyDecayMS);
    if (ticks > 0) {
      settledGT += ticks * cfg.EnergyDecayMS;
      const decay = ticks * cfg.EnergyDecayDelta;
      energy = Number.isSafeInteger(decay) ? Math.max(0, energy - decay) : 0;
    }
    return energy;
  }

  function charge(amount) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("energy charge must be a nonnegative safe integer");
    energy = amount > Number.MAX_SAFE_INTEGER - energy ? Number.MAX_SAFE_INTEGER : energy + amount;
    return energy;
  }

  function multiplier() {
    return Math.max(cfg.EnergyMultiplierMinimum, energy / cfg.EnergyMultiplierDivisor);
  }

  function applyScore(rawScore) {
    if (!Number.isSafeInteger(rawScore) || rawScore < 0) throw new RangeError("rawScore must be a nonnegative safe integer");
    const effectiveEnergy = Math.max(
      energy,
      cfg.EnergyMultiplierMinimum * cfg.EnergyMultiplierDivisor,
    );
    const value = BigInt(rawScore) * BigInt(effectiveEnergy) / BigInt(cfg.EnergyMultiplierDivisor);
    return value >= BigInt(SCORE_MAX) ? SCORE_MAX : Number(value);
  }

  function snapshot() {
    return Object.freeze({ energy, multiplier: multiplier(), settledGT });
  }

  return Object.freeze({ advanceTo, charge, applyScore, snapshot });
}

function validateEnergyConfig(cfg) {
  for (const key of [
    "EnergyInitial", "EnergyDecayMS", "EnergyDecayDelta",
    "EnergyMultiplierDivisor", "EnergyMultiplierMinimum",
  ]) {
    if (!Number.isSafeInteger(cfg?.[key]) || cfg[key] <= 0) throw new RangeError(`Invalid energy config: ${key}`);
  }
}
