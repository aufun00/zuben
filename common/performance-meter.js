import { PHASE_RUNNING, PHASE_SETTLING } from "./game-controller.js";

export const PERFORMANCE_METER_CFG = Object.freeze({
  windowMs: 2_000,
  refreshMs: 500,
  // Whole-row status colors: TPS green >=32, orange 20-<32, red <20;
  // FPS green >=45, orange 25-<45, red <25. Warming/inactive rows stay gray.
  tps: Object.freeze({ warningBelow: 32, criticalBelow: 20 }),
  fps: Object.freeze({ warningBelow: 45, criticalBelow: 25 }),
});

export function getPerformanceLevel(rate, thresholds) {
  if (!Number.isFinite(rate)) return "warming";
  if (rate < thresholds.criticalBelow) return "critical";
  if (rate < thresholds.warningBelow) return "warning";
  return "normal";
}

export function createPerformanceMeter(container, cfg = PERFORMANCE_METER_CFG) {
  const element = document.createElement("aside");
  element.className = "performance-meter";
  element.setAttribute("aria-label", "Game performance");
  element.innerHTML = `
    ${meterRow("tps", "TPS")}
    ${meterRow("fps", "FPS")}
  `;
  container.append(element);

  const values = {
    tps: element.querySelector('[data-performance-value="tps"]'),
    fps: element.querySelector('[data-performance-value="fps"]'),
  };
  const rows = {
    tps: element.querySelector('[data-performance-row="tps"]'),
    fps: element.querySelector('[data-performance-row="fps"]'),
  };
  let phase = null;
  let measuring = false;
  let startedAtMs = null;
  let tickTimes = [];
  let frameTimes = [];
  let frameId = null;
  let destroyed = false;

  const refreshTimer = setInterval(refresh, cfg.refreshMs);

  function setPhase(nextPhase) {
    phase = nextPhase;
    if (nextPhase === PHASE_RUNNING && !measuring) startMeasurement();
    else if (nextPhase !== PHASE_RUNNING && nextPhase !== PHASE_SETTLING) stopMeasurement();
    refresh();
  }

  function recordTick(nowMs = performance.now()) {
    if (!measuring || !Number.isFinite(nowMs)) return;
    tickTimes.push(nowMs);
    tickTimes = prune(tickTimes, nowMs - cfg.windowMs);
  }

  function startMeasurement() {
    measuring = true;
    startedAtMs = performance.now();
    tickTimes = [];
    frameTimes = [];
    if (!cfg.manualFrames) frameId = requestAnimationFrame(recordFrame);
  }

  function stopMeasurement() {
    measuring = false;
    startedAtMs = null;
    tickTimes = [];
    frameTimes = [];
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }

  function recordFrame(nowMs) {
    if (!measuring || destroyed) return;
    frameTimes.push(nowMs);
    frameTimes = prune(frameTimes, nowMs - cfg.windowMs);
    if (!cfg.manualFrames) frameId = requestAnimationFrame(recordFrame);
  }

  function refresh() {
    // Atomic settlement is still active gameplay: keep the same window visible
    // so a valid click never flashes both rows back to the inactive gray state.
    const displayActive = phase === PHASE_RUNNING || phase === PHASE_SETTLING;
    if (destroyed || !displayActive || !measuring) {
      renderValue("tps", null);
      renderValue("fps", null);
      return;
    }
    const nowMs = performance.now();
    if (startedAtMs === null || nowMs - startedAtMs < cfg.windowMs) {
      renderValue("tps", null);
      renderValue("fps", null);
      return;
    }
    tickTimes = prune(tickTimes, nowMs - cfg.windowMs);
    frameTimes = prune(frameTimes, nowMs - cfg.windowMs);
    renderValue("tps", sampleRate(tickTimes, cfg.windowMs));
    renderValue("fps", sampleRate(frameTimes, cfg.windowMs));
  }

  function renderValue(kind, rate) {
    const rounded = Number.isFinite(rate) ? (cfg.roundNearest ? Math.round(rate) : Math.floor(rate)) : null;
    values[kind].textContent = rounded === null ? "--" : String(rounded);
    rows[kind].dataset.level = getPerformanceLevel(rate, cfg[kind]);
    rows[kind].setAttribute("aria-label", rounded === null
      ? `${kind.toUpperCase()} warming up`
      : `${kind.toUpperCase()} ${rounded}; warning below ${cfg[kind].warningBelow}; critical below ${cfg[kind].criticalBelow}`);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearInterval(refreshTimer);
    stopMeasurement();
    element.remove();
  }

  refresh();
  return Object.freeze({ element, setPhase, recordTick, recordFrame, destroy });
}

function meterRow(kind, label) {
  return `<div class="performance-meter-row" data-performance-row="${kind}" data-level="warming">
    <span class="performance-meter-label">${label}</span>
    <strong data-performance-value="${kind}">--</strong>
  </div>`;
}

function prune(samples, cutoffMs) {
  let first = 0;
  while (first < samples.length && samples[first] < cutoffMs) first += 1;
  return first === 0 ? samples : samples.slice(first);
}

function sampleRate(samples, windowMs) {
  return samples.length * 1_000 / windowMs;
}
