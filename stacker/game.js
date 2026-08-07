import { disposeGamePageResources, ensureGameStylesheet, failGamePage, formatElapsed, formatRemaining, handleGameVisibilityChange, renderControllerFailure, renderGameShell, updateGameControlButton, updateGamePhasePresentation, updateGameSurfaceState, updateTugBar } from "../common/game-shell.js";
import { updateGameBarCharge } from "../common/game-bar-charge.js";
import { updateGameResultView } from "../common/game-result.js";
import { bindGameInput } from "../common/gesture-input.js";
import { openModal } from "../common/modal.js";
import { clearStackerCheckpoint, loadStackerCheckpoint, saveStackerCheckpoint } from "./checkpoint.js";
import { cfg, STACKER_PERFORMANCE_CFG } from "./config.js";
import { GAME_LANG } from "./lang.js";
import { createStackerRenderer } from "./render.js";
import { PHASE_ENDED, PHASE_RUNNING, createStackerRuntime } from "./runtime.js";

ensureGameStylesheet(import.meta.url);

export function renderGamePage(mount, context) {
  renderGameShell(mount, { ...context, gameStrings: GAME_LANG, setupGame: setupStacker, performanceMeterCfg: STACKER_PERFORMANCE_CFG });
}

function setupStacker({ page, gameZone, game, gameIdx, parsed, durationMs, unlimited, ghostScore, strings, localized, performanceMeter }) {
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
  let renderedEnergy = null;
  let renderedLayer = null;
  let renderedShape = null;
  let savedCheckpointRevision = -1;
  let checkpointPrompt = null;

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

  const storedCheckpoint = unlimited ? loadStackerCheckpoint(parsed.code) : null;
  try {
    createRuntime(storedCheckpoint);
  } catch (restoreError) {
    if (storedCheckpoint === null) {
      onError(restoreError, "INIT");
      return { cleanup() {} };
    }
    clearStackerCheckpoint(parsed.code);
    try {
      createRuntime(null);
    } catch (error) {
      onError(error, "INIT");
      return { cleanup() {} };
    }
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
  if (storedCheckpoint !== null && runtime.snapshot().phase !== "PHASE_READY") showCheckpointPrompt();

  function createRuntime(checkpoint) {
    runtime = createStackerRuntime({ cfg, seed: parsed.seed, limitMS: durationMs, checkpoint, onSnapshot, onPump: performanceMeter.recordTick, onError });
    renderer = createStackerRenderer({ gameZone, runtime, performanceMeter });
  }

  function onSnapshot(snapshot) {
    if (destroyed || failed || !snapshot) return;
    const enteredRunning = latest?.phase !== PHASE_RUNNING && snapshot.phase === PHASE_RUNNING;
    latest = snapshot;
    const phaseChanged = updateGamePhasePresentation({ gameZone, playfield, performanceMeter }, { phase: snapshot.phase, previousPhase: renderedPhase, settling: snapshot.settling });
    gameZone.dataset.operation = snapshot.operation;

    const timeText = unlimited ? formatElapsed(snapshot.runGT) : formatRemaining(snapshot.remainingMS);
    if (forceChrome || renderedTime !== timeText) {
      page.querySelector("[data-time]").textContent = timeText;
      renderedTime = timeText;
    }
    const ghostElapsed = unlimited || snapshot.phase === PHASE_ENDED ? 0 : snapshot.runGT;
    const shownGhost = unlimited ? ghostScore : Math.floor(ghostScore * Math.min(ghostElapsed, durationMs) / durationMs);
    if (forceChrome || renderedScore !== snapshot.score || renderedGhost !== shownGhost) {
      updateTugBar(page, snapshot.score, ghostScore, activeStrings, ghostElapsed, durationMs ?? 0);
      renderedScore = snapshot.score;
      renderedGhost = shownGhost;
    }
    if (forceChrome || renderedEnergy !== snapshot.energy) {
      updateGameBarCharge(page, {
        value: snapshot.energy,
        greenThreshold: cfg.EnergyGreenThreshold,
        orangeThreshold: cfg.EnergyOrangeThreshold,
        purpleThreshold: cfg.EnergyPurpleThreshold,
        label: activeLocalized.energy,
      });
      renderedEnergy = snapshot.energy;
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

    if (unlimited && snapshot.phase === PHASE_ENDED) {
      clearStackerCheckpoint(parsed.code);
      savedCheckpointRevision = -1;
    } else if (unlimited && snapshot.checkpoint && snapshot.checkpointRevision !== savedCheckpointRevision) {
      saveStackerCheckpoint(parsed.code, snapshot.checkpoint);
      savedCheckpointRevision = snapshot.checkpointRevision;
    }
  }

  function showCheckpointPrompt() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <section class="modal-card stacker-checkpoint-dialog" role="dialog" aria-labelledby="stacker-checkpoint-title">
        <h2 id="stacker-checkpoint-title" data-checkpoint-title></h2>
        <p data-checkpoint-copy></p>
        <div class="modal-actions">
          <button class="action-button" type="button" data-checkpoint-new></button>
          <button class="action-button primary" type="button" data-checkpoint-continue></button>
        </div>
      </section>`;
    const continueButton = backdrop.querySelector("[data-checkpoint-continue]");
    const newButton = backdrop.querySelector("[data-checkpoint-new]");
    const promptState = { backdrop, modal: null, setLanguage: renderCheckpointPrompt };
    checkpointPrompt = promptState;
    renderCheckpointPrompt();
    const modal = openModal(backdrop, {
      initialFocus: continueButton,
      returnFocus: page.querySelector(".game-button"),
      closeOnBackdrop: false,
      onBeforeClose: () => { if (checkpointPrompt === promptState) checkpointPrompt = null; },
    });
    promptState.modal = modal;
    continueButton.addEventListener("click", () => { modal.close(); checkpointPrompt = null; });
    newButton.addEventListener("click", () => {
      modal.close({ restoreFocus: false });
      checkpointPrompt = null;
      clearStackerCheckpoint(parsed.code);
      savedCheckpointRevision = -1;
      runtime.destroy();
      renderer.destroy();
      latest = null;
      renderedPhase = null;
      forceChrome = true;
      renderedEnergy = null;
      try {
        createRuntime(null);
        onSnapshot(runtime.snapshot());
      } catch (error) {
        onError(error, "INIT");
      }
    });
  }

  function renderCheckpointPrompt() {
    if (!checkpointPrompt) return;
    checkpointPrompt.backdrop.querySelector("[data-checkpoint-title]").textContent = activeLocalized.checkpointTitle;
    checkpointPrompt.backdrop.querySelector("[data-checkpoint-copy]").textContent = activeLocalized.checkpointCopy;
    checkpointPrompt.backdrop.querySelector("[data-checkpoint-new]").textContent = activeLocalized.checkpointNew;
    checkpointPrompt.backdrop.querySelector("[data-checkpoint-continue]").textContent = activeLocalized.checkpointContinue;
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
      checkpointPrompt?.setLanguage();
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
      checkpointPrompt?.modal?.close({ restoreFocus: false });
      checkpointPrompt = null;
      ({ input, renderer, runtime } = disposeGamePageResources({ visibilityHandler: onVisibility, input, renderer, runtime }));
    },
  };
}
