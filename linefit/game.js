import {
  formatRemaining,
  renderControllerFailure,
  renderGameShell,
  setControlButton,
  updateTugBar,
} from "../common/game-shell.js";
import { createGameResultView } from "../common/game-result.js";
import { bindGameInput } from "../common/gesture-input.js";
import { cfg, LINEFIT_PERFORMANCE_CFG, LINEFIT_SHAPES } from "./config.js";
import { GAME_LANG } from "./lang.js";
import { createLineFitRenderer, getEnergyProgress } from "./render.js";
import {
  OPERATION_IDLE,
  PHASE_ENDED,
  PHASE_ERROR,
  PHASE_PAUSED,
  PHASE_READY,
  PHASE_RUNNING,
  createLineFitRuntime,
} from "./runtime.js";

ensureStylesheet();

export function renderGamePage(mount, context) {
  renderGameShell(mount, {
    ...context,
    gameStrings: GAME_LANG,
    setupGame: setupLineFit,
    performanceMeterCfg: LINEFIT_PERFORMANCE_CFG,
  });
}

function setupLineFit({ page, gameZone, game, gameIdx, parsed, durationMs, ghostScore, strings, localized, performanceMeter }) {
  let activeStrings = strings;
  let activeLocalized = localized;
  let latestSnapshot = null;
  let resultView = null;
  let input = null;
  let renderer = null;
  let runtime = null;
  let destroyed = false;
  let failed = false;
  let forceChrome = true;
  let renderedPhase = null;
  let renderedTime = null;
  let renderedScore = null;
  let renderedGhost = null;
  let renderedEnergy = null;
  let renderedMultiplier = null;
  let renderedPieces = null;
  let renderedLines = null;

  gameZone.classList.add("linefit-zone");
  gameZone.innerHTML = `
    <div class="linefit-playfield" data-linefit-playfield role="application" tabindex="-1">
      <div class="linefit-energy" data-energy-tier="idle">
        <div class="linefit-energy-track" data-energy-track role="progressbar" aria-valuemin="0" aria-valuemax="${cfg.EnergyPurpleThreshold}">
          <span class="linefit-energy-marker linefit-energy-marker-green"></span>
          <span class="linefit-energy-marker linefit-energy-marker-orange"></span>
          <span class="linefit-energy-fill" data-energy-fill></span>
        </div>
        <strong class="linefit-energy-multiplier" data-energy-multiplier>×1.0</strong>
      </div>
      <div class="linefit-hud">
        <span><span data-pieces-label></span><strong data-placement-count>0</strong></span>
        <span><span data-lines-label></span><strong data-line-count>0</strong></span>
      </div>
      <div class="linefit-board" data-linefit-board aria-hidden="true">
        <div class="linefit-grid" data-linefit-grid></div>
      </div>
      <div class="linefit-tray" data-linefit-tray></div>
    </div>
    <div class="linefit-cover" data-linefit-cover>
      <div class="rules-card linefit-rules">
        <h1 data-instructions-title></h1>
        <p data-rules-copy></p>
        <ol><li data-operation-place></li><li data-operation-batch></li><li data-operation-score></li></ol>
      </div>
    </div>
    <div class="linefit-overlay game-result-overlay" data-linefit-overlay hidden></div>
  `;

  const playfield = gameZone.querySelector("[data-linefit-playfield]");
  const tray = gameZone.querySelector("[data-linefit-tray]");
  const cover = gameZone.querySelector("[data-linefit-cover]");
  const overlay = gameZone.querySelector("[data-linefit-overlay]");
  const energyMeter = gameZone.querySelector(".linefit-energy");
  applyEnergyBarConfig(energyMeter);
  gameZone.append(performanceMeter.element);

  try {
    runtime = createLineFitRuntime({
      cfg,
      shapes: LINEFIT_SHAPES,
      seed: parsed.seed,
      limitMS: durationMs,
      onSnapshot,
      onPump: performanceMeter.recordTick,
      onError,
    });
    renderer = createLineFitRenderer({ gameZone, runtime, performanceMeter });
  } catch (error) {
    onError(error);
    return { cleanup() {} };
  }

  page.querySelector(".game-button").addEventListener("click", () => runtime.enqueueGameBarClick(performance.now()));
  input = bindGameInput(tray, {
    recognizer: "drag",
    thresholdPx: cfg.DragThresholdPx,
    resolveContext: (event) => renderer.resolveDragContext(event),
    handle(inputEvent) {
      const drop = renderer.handleDrag(inputEvent);
      if (drop) runtime.enqueueAction(drop.trayIndex, drop.row, drop.column, performance.now());
    },
  });
  document.addEventListener("visibilitychange", onVisibility);
  renderInstructionText();
  onSnapshot(runtime.snapshot());

  function onSnapshot(snapshot) {
    if (destroyed || failed || !snapshot) return;
    const enteredRunning = latestSnapshot?.phase !== PHASE_RUNNING && snapshot.phase === PHASE_RUNNING;
    latestSnapshot = snapshot;
    const phaseChanged = renderedPhase !== snapshot.phase;
    if (phaseChanged) {
      performanceMeter.setPhase(snapshot.phase);
      gameZone.dataset.phase = snapshot.phase;
    }
    const timeText = formatRemaining(snapshot.remainingMS);
    if (forceChrome || renderedTime !== timeText) {
      page.querySelector("[data-time]").textContent = timeText;
      renderedTime = timeText;
    }
    const ghostElapsed = snapshot.phase === PHASE_ENDED ? durationMs : snapshot.runGT;
    const shownGhost = durationMs === 0 ? ghostScore : Math.floor(ghostScore * Math.min(ghostElapsed, durationMs) / durationMs);
    if (forceChrome || renderedScore !== snapshot.score || renderedGhost !== shownGhost) {
      updateTugBar(page, snapshot.score, ghostScore, activeStrings, ghostElapsed, durationMs);
      renderedScore = snapshot.score;
      renderedGhost = shownGhost;
    }
    if (forceChrome || renderedEnergy !== snapshot.energy || renderedMultiplier !== snapshot.scoreMultiplier) {
      const track = gameZone.querySelector("[data-energy-track]");
      const multiplierText = `×${snapshot.scoreMultiplier.toFixed(1)}`;
      energyMeter.dataset.energyTier = energyTier(snapshot.energy);
      energyMeter.style.setProperty("--energy-progress", String(getEnergyProgress(snapshot.energy)));
      track.setAttribute("aria-label", activeLocalized.energy);
      track.setAttribute("aria-valuenow", String(snapshot.energy));
      track.setAttribute("aria-valuetext", `${snapshot.energy}, ${multiplierText}`);
      gameZone.querySelector("[data-energy-multiplier]").textContent = multiplierText;
      renderedEnergy = snapshot.energy;
      renderedMultiplier = snapshot.scoreMultiplier;
    }
    const boardMetaChanged = forceChrome || renderedPieces !== snapshot.placementCount || renderedLines !== snapshot.clearedLineCount;
    if (forceChrome || renderedPieces !== snapshot.placementCount) {
      gameZone.querySelector("[data-placement-count]").textContent = String(snapshot.placementCount);
      renderedPieces = snapshot.placementCount;
    }
    if (forceChrome || renderedLines !== snapshot.clearedLineCount) {
      gameZone.querySelector("[data-line-count]").textContent = String(snapshot.clearedLineCount);
      renderedLines = snapshot.clearedLineCount;
    }
    if (boardMetaChanged) {
      playfield.setAttribute("aria-label", `${activeLocalized.board}. ${activeLocalized.pieces} ${snapshot.placementCount}. ${activeLocalized.lines} ${snapshot.clearedLineCount}.`);
    }

    const button = page.querySelector(".game-button");
    if (phaseChanged || forceChrome) {
      if (snapshot.phase === PHASE_READY) {
        button.disabled = false;
        setControlButton(button, "play", activeStrings.start);
      } else if (snapshot.phase === PHASE_RUNNING) {
        button.disabled = false;
        setControlButton(button, "pause", activeStrings.pause);
      } else if (snapshot.phase === PHASE_PAUSED) {
        button.disabled = false;
        setControlButton(button, "play", activeStrings.resume);
      } else if (snapshot.phase === PHASE_ENDED) {
        button.disabled = true;
        setControlButton(button, "finish", activeStrings.finished);
      } else if (snapshot.phase === PHASE_ERROR) {
        button.disabled = true;
        setControlButton(button, "finish", activeStrings.failed);
      }
      cover.hidden = snapshot.phase === PHASE_RUNNING || snapshot.phase === PHASE_ENDED;
      playfield.tabIndex = snapshot.phase === PHASE_RUNNING ? 0 : -1;
      playfield.setAttribute("aria-disabled", String(snapshot.phase !== PHASE_RUNNING));
      overlay.hidden = snapshot.phase !== PHASE_ENDED;
    }

    if (snapshot.phase !== PHASE_RUNNING || snapshot.operation !== OPERATION_IDLE) {
      input?.cancelSession();
      renderer?.cancelDrag();
    }
    if (enteredRunning) playfield.focus({ preventScroll: true });
    if (snapshot.phase === PHASE_ENDED && !resultView) {
      resultView = createGameResultView({
        overlay,
        gameIdx,
        game,
        parsed,
        result: snapshot.result,
        ghostScore,
        language: document.documentElement.lang.startsWith("zh") ? "zh" : "en",
        strings: activeStrings,
        localized: activeLocalized,
      });
    }
    renderedPhase = snapshot.phase;
    forceChrome = false;
  }

  function onVisibility() {
    if (document.hidden) {
      input?.cancelSession();
      renderer?.cancelDrag();
      runtime?.enqueuePause(performance.now());
      renderer?.setVisible(false);
    } else {
      renderer?.setVisible(true);
    }
  }

  function onError(error) {
    console.error("LineFit failed", error);
    failed = true;
    input?.destroy();
    renderer?.destroy();
    runtime?.destroy();
    renderControllerFailure(page, activeStrings);
  }

  function renderInstructionText() {
    gameZone.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    gameZone.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    gameZone.querySelector("[data-operation-place]").textContent = activeLocalized.operationPlace;
    gameZone.querySelector("[data-operation-batch]").textContent = activeLocalized.operationBatch;
    gameZone.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
    gameZone.querySelector("[data-pieces-label]").textContent = activeLocalized.pieces;
    gameZone.querySelector("[data-lines-label]").textContent = activeLocalized.lines;
  }

  return {
    setLanguage({ strings: nextStrings, localized: nextLocalized }) {
      activeStrings = nextStrings;
      activeLocalized = nextLocalized;
      if (failed) {
        renderControllerFailure(page, activeStrings);
        return;
      }
      renderInstructionText();
      forceChrome = true;
      resultView?.setLanguage({
        language: document.documentElement.lang.startsWith("zh") ? "zh" : "en",
        strings: activeStrings,
        localized: activeLocalized,
      });
      if (latestSnapshot) onSnapshot(latestSnapshot);
    },
    cleanup() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      input?.destroy();
      renderer?.destroy();
      runtime?.destroy();
    },
  };
}

function ensureStylesheet() {
  const href = new URL("./game.css", import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

function energyTier(energy) {
  if (energy >= cfg.EnergyPurpleThreshold) return "purple";
  if (energy >= cfg.EnergyOrangeThreshold) return "orange";
  if (energy >= cfg.EnergyGreenThreshold) return "green";
  return "idle";
}

function applyEnergyBarConfig(element) {
  element.style.setProperty("--energy-idle-color", cfg.EnergyBarIdleColor);
  element.style.setProperty("--energy-green-color", cfg.EnergyBarGreenColor);
  element.style.setProperty("--energy-orange-color", cfg.EnergyBarOrangeColor);
  element.style.setProperty("--energy-purple-color", cfg.EnergyBarPurpleColor);
  element.style.setProperty("--energy-bar-height", `${cfg.EnergyBarHeightPx}px`);
  element.style.setProperty("--energy-multiplier-width", `${cfg.EnergyBarMultiplierWidthPx}px`);
  element.style.setProperty("--energy-transition-ms", `${cfg.EnergyBarTransitionMS}ms`);
}
