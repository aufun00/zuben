import { disposeGamePageResources, ensureGameStylesheet, failGamePage, formatRemaining, handleGameVisibilityChange, renderControllerFailure, renderGameShell, updateGameControlButton, updateGamePhasePresentation, updateGameSurfaceState, updateTugBar } from "../common/game-shell.js";
import { updateGameBarCharge } from "../common/game-bar-charge.js";
import { updateGameResultView } from "../common/game-result.js";
import { bindGameInput } from "../common/gesture-input.js";
import { cfg, STACKER_PERFORMANCE_CFG } from "./config.js";
import { GAME_LANG } from "./lang.js";
import { createStackerRenderer } from "./render.js";
import { PHASE_ENDED, PHASE_RUNNING, createStackerRuntime } from "./runtime.js";

ensureGameStylesheet(import.meta.url);

export function renderGamePage(mount, context) {
  renderGameShell(mount, { ...context, gameStrings: GAME_LANG, setupGame: setupStacker, performanceMeterCfg: STACKER_PERFORMANCE_CFG });
}

function setupStacker({ page, gameZone, game, gameIdx, parsed, durationMs, ghostScore, strings, localized, performanceMeter }) {
  let activeStrings = strings;
  let activeLocalized = localized;
  let latest = null;
  let resultView = null;
  let input = null;
  let runtime = null;
  let renderer = null;
  let destroyed = false;
  let failed = false;
  let failureCode = null;
  let forceChrome = true;
  let renderedPhase = null;
  let renderedTime = null;
  let renderedScore = null;
  let renderedGhost = null;
  let renderedLayer = null;
  let renderedShape = null;

  gameZone.classList.add("stacker-zone");
  gameZone.style.setProperty("--stacker-land-ms", `${cfg.LandingMS}ms`);
  gameZone.innerHTML = `
    <div class="stacker-playfield" data-playfield role="button" tabindex="-1">
      <svg class="stacker-scene" data-scene viewBox="0 0 600 620" role="img">
        <g data-camera>
          <g data-static-tower></g>
          <g data-footprint></g>
          <g class="stacker-layer moving" data-moving></g>
        </g>
      </svg>
      <div class="stacker-readout" aria-live="polite"><span data-layer-readout></span><span data-shape-readout></span></div>
    </div>
    <div class="stacker-cover" data-cover>
      <div class="rules-card stacker-rules">
        <h1 data-instructions-title></h1>
        <p data-rules-copy></p>
        <ol><li data-operation-drop></li><li data-operation-footprint></li><li data-operation-score></li></ol>
      </div>
    </div>
    <div class="stacker-overlay game-result-overlay" data-overlay hidden></div>`;

  const playfield = gameZone.querySelector("[data-playfield]");
  const scene = gameZone.querySelector("[data-scene]");
  const cover = gameZone.querySelector("[data-cover]");
  const overlay = gameZone.querySelector("[data-overlay]");

  try {
    runtime = createStackerRuntime({ cfg, seed: parsed.seed, limitMS: durationMs, onSnapshot, onPump: performanceMeter.recordTick, onError });
    renderer = createStackerRenderer({ gameZone, runtime, performanceMeter });
  } catch (error) {
    onError(error, "INIT");
    return { cleanup() {} };
  }

  page.querySelector(".game-button").addEventListener("click", () => runtime.enqueueGameBarClick(performance.now()));
  input = bindGameInput(playfield, {
    recognizer: "press",
    handle(event) {
      if (event.type === "press") runtime.enqueueAction(performance.now());
    },
  });
  document.addEventListener("visibilitychange", onVisibility);
  renderInstructionText();
  onSnapshot(runtime.snapshot());

  function onSnapshot(snapshot) {
    if (destroyed || failed || !snapshot) return;
    const enteredRunning = latest?.phase !== PHASE_RUNNING && snapshot.phase === PHASE_RUNNING;
    latest = snapshot;
    const phaseChanged = updateGamePhasePresentation({ gameZone, playfield, performanceMeter }, { phase: snapshot.phase, previousPhase: renderedPhase, settling: snapshot.settling });
    gameZone.dataset.operation = snapshot.operation;

    const timeText = formatRemaining(snapshot.remainingMS);
    if (forceChrome || renderedTime !== timeText) {
      page.querySelector("[data-time]").textContent = timeText;
      renderedTime = timeText;
    }
    const ghostElapsed = snapshot.phase === PHASE_ENDED ? durationMs : snapshot.runGT;
    const shownGhost = Math.floor(ghostScore * Math.min(ghostElapsed, durationMs) / durationMs);
    if (forceChrome || renderedScore !== snapshot.score || renderedGhost !== shownGhost) {
      updateTugBar(page, snapshot.score, ghostScore, activeStrings, ghostElapsed, durationMs);
      renderedScore = snapshot.score;
      renderedGhost = shownGhost;
    }
    if (forceChrome) {
      updateGameBarCharge(page, { value: cfg.InitialEnergy, greenThreshold: 100, orangeThreshold: 200, purpleThreshold: 400, label: activeLocalized.energy });
    }

    if (forceChrome || renderedLayer !== snapshot.layerCount) {
      gameZone.querySelector("[data-layer-readout]").textContent = `${activeLocalized.layer} ${snapshot.layerCount}`;
      renderedLayer = snapshot.layerCount;
    }
    if (forceChrome || renderedShape !== snapshot.moving.shapeID) {
      gameZone.querySelector("[data-shape-readout]").textContent = activeLocalized.shapes[snapshot.moving.shapeID] ?? snapshot.moving.shapeID;
      renderedShape = snapshot.moving.shapeID;
    }

    if (phaseChanged || forceChrome) {
      const button = page.querySelector(".game-button");
      updateGameControlButton(button, snapshot.phase, activeStrings);
      updateGameSurfaceState({ cover, playfield, overlay }, snapshot.phase);
      if (snapshot.phase !== PHASE_RUNNING) input?.cancelSession();
    }

    if (enteredRunning) playfield.focus({ preventScroll: true });
    ({ input, resultView } = updateGameResultView({
      phase: snapshot.phase, resultView, input,
      overlay, gameIdx, game, parsed, result: snapshot.result, ghostScore,
      language: document.documentElement.lang.startsWith("zh") ? "zh" : "en",
      strings: activeStrings, localized: activeLocalized,
    }));
    renderedPhase = snapshot.phase;
    forceChrome = false;
  }

  function onVisibility() {
    handleGameVisibilityChange({ hidden: document.hidden, input, runtime, renderer });
  }

  function onError(error, stage = "RUNTIME") {
    failed = true;
    const failure = failGamePage({ gameID: game.gameID, stage, error, page, strings: activeStrings, visibilityHandler: onVisibility, input, renderer, runtime });
    ({ input, renderer, runtime, errorCode: failureCode } = failure);
  }

  function renderInstructionText() {
    playfield.setAttribute("aria-label", `${activeLocalized.tower}. ${activeLocalized.drop}`);
    scene.setAttribute("aria-label", activeLocalized.tower);
    gameZone.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    gameZone.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    gameZone.querySelector("[data-operation-drop]").textContent = activeLocalized.operationDrop;
    gameZone.querySelector("[data-operation-footprint]").textContent = activeLocalized.operationFootprint;
    gameZone.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
  }

  return {
    setLanguage({ strings: nextStrings, localized: nextLocalized }) {
      activeStrings = nextStrings;
      activeLocalized = nextLocalized;
      if (failed) { renderControllerFailure(page, activeStrings, failureCode); return; }
      renderInstructionText();
      forceChrome = true;
      renderedLayer = null;
      renderedShape = null;
      resultView?.setLanguage({ language: document.documentElement.lang.startsWith("zh") ? "zh" : "en", strings: activeStrings, localized: activeLocalized });
      if (latest) onSnapshot(latest);
    },
    cleanup() {
      if (destroyed) return;
      destroyed = true;
      ({ input, renderer, runtime } = disposeGamePageResources({ visibilityHandler: onVisibility, input, renderer, runtime }));
    },
  };
}
