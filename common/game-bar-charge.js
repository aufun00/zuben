export const GAME_BAR_CHARGE_DEFAULTS = Object.freeze({
  value: 50,
  greenThreshold: 100,
  orangeThreshold: 200,
  purpleThreshold: 400,
});

export function calculateGameBarChargeProgress(value, thresholds = GAME_BAR_CHARGE_DEFAULTS) {
  validateCharge(value, thresholds);
  const { greenThreshold: green, orangeThreshold: orange, purpleThreshold: purple } = thresholds;
  if (value >= purple) return 1;
  if (value >= orange) return (2 + (value - orange) / (purple - orange)) / 3;
  if (value >= green) return (1 + (value - green) / (orange - green)) / 3;
  return value / green / 3;
}

export function updateGameBarCharge(page, {
  value,
  greenThreshold,
  orangeThreshold,
  purpleThreshold,
  label,
}) {
  const thresholds = { greenThreshold, orangeThreshold, purpleThreshold };
  const progress = calculateGameBarChargeProgress(value, thresholds);
  const element = page?.querySelector?.("[data-game-bar-charge]");
  if (!element) throw new Error("GameBar charge element is unavailable");

  element.dataset.chargeTier = chargeTier(value, thresholds);
  element.style.setProperty("--game-charge-progress", String(progress));
  element.removeAttribute("aria-hidden");
  element.setAttribute("role", "progressbar");
  element.setAttribute("aria-label", String(label || "Charge"));
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", String(purpleThreshold));
  element.setAttribute("aria-valuenow", String(Math.min(value, purpleThreshold)));
  element.setAttribute("aria-valuetext", String(value));
}

function chargeTier(value, { greenThreshold, orangeThreshold, purpleThreshold }) {
  if (value >= purpleThreshold) return "purple";
  if (value >= orangeThreshold) return "orange";
  if (value >= greenThreshold) return "green";
  return "idle";
}

function validateCharge(value, { greenThreshold, orangeThreshold, purpleThreshold }) {
  for (const item of [value, greenThreshold, orangeThreshold, purpleThreshold]) {
    if (!Number.isSafeInteger(item) || item < 0) throw new RangeError("GameBar charge values must be nonnegative safe integers");
  }
  if (greenThreshold === 0 || !(greenThreshold < orangeThreshold && orangeThreshold < purpleThreshold)) {
    throw new RangeError("GameBar charge thresholds must be positive and ascending");
  }
}
