import {
  disposeGamePageResources,
  ensureGameStylesheet,
  failGamePage,
  formatElapsed,
  formatRemaining,
  handleGameVisibilityChange,
  renderControllerFailure,
  renderGameShell,
  updateGameControlButton,
  updateGamePhasePresentation,
  updateGameSurfaceState,
  updateTugBar,
} from "../common/game-shell.js";
import { updateGameBarCharge } from "../common/game-bar-charge.js";
import { updateGameResultView } from "../common/game-result.js";
import { bindGameInput } from "../common/gesture-input.js";
import { openModal } from "../common/modal.js";
import { clearSnakeCheckpoint, loadSnakeCheckpoint, saveSnakeCheckpoint } from "./checkpoint.js";
import { cfg, SNAKE_PERFORMANCE_CFG } from "./config.js";
import { dominantDirection } from "./engine.js";
import { GAME_LANG } from "./lang.js";
import { createSnakeRenderer } from "./render.js";
import { PHASE_ENDED, PHASE_PREPARING, PHASE_READY, PHASE_RUNNING, createSnakeRuntime } from "./runtime.js";

ensureGameStylesheet(import.meta.url);

export function renderGamePage(mount, context) {
  renderGameShell(mount, { ...context, gameStrings: GAME_LANG, setupGame: setupSnake, performanceMeterCfg: SNAKE_PERFORMANCE_CFG });
}

function setupSnake({ page, gameZone, game, gameIdx, parsed, durationMs, unlimited, ghostScore, strings, localized, performanceMeter }) {
  let activeStrings = strings;
  let activeLocalized = localized;
  let latestSnapshot = null;
  let resultView = null;
  let input = null;
  let renderer = null;
  let runtime = null;
  let destroyed = false;
  let failed = false;
  let failureCode = null;
  let forceChrome = true;
  let renderedPhase = null;
  let renderedTime = null;
  let renderedScore = null;
  let renderedGhost = null;
  let renderedEnergy = null;
  let renderedLength = null;
  let renderedSpeed = null;
  let savedCheckpointRevision = -1;
  let checkpointPrompt = null;

  gameZone.classList.add("snake-zone");
  gameZone.innerHTML += `
    <div class="snake-playfield" data-snake-playfield role="application" tabindex="-1">
      <div class="snake-hud">
        <span><span data-length-label></span><strong data-snake-length>${cfg.InitialLength}</strong></span>
        <span><span data-speed-label></span><strong data-snake-speed>${(1000 / cfg.InitialStepMS).toFixed(1)}</strong></span>
      </div>
      <div class="snake-board" data-snake-board aria-hidden="true">
        <div class="snake-cells" data-snake-cells></div>
        <div class="snake-feedback" data-snake-feedback></div>
      </div>
    </div>
    <div class="snake-cover" data-snake-cover>
      <div class="rules-card snake-rules">
        <h1 data-instructions-title></h1>
        <p data-rules-copy></p>
        <ol><li data-operation-move></li><li data-operation-reward></li><li data-operation-score></li></ol>
      </div>
    </div>
    <div class="snake-overlay game-result-overlay" data-snake-overlay hidden></div>`;

  const playfield = gameZone.querySelector("[data-snake-playfield]");
  const cover = gameZone.querySelector("[data-snake-cover]");
  const overlay = gameZone.querySelector("[data-snake-overlay]");
  const countdown = gameZone.querySelector("[data-countdown]");
  const storedCheckpoint = unlimited ? loadSnakeCheckpoint(parsed.code) : null;

  try { createRuntime(storedCheckpoint); }
  catch (restoreError) {
    if (storedCheckpoint === null) { onError(restoreError, "INIT"); return { cleanup() {} }; }
    clearSnakeCheckpoint(parsed.code);
    try { createRuntime(null); }
    catch (error) { onError(error, "INIT"); return { cleanup() {} }; }
  }

  page.querySelector(".game-button").addEventListener("click", () => runtime.enqueueGameBarClick(performance.now()));
  input = bindGameInput(gameZone, {
    recognizer: "swipe",
    thresholdPx: cfg.SwipeThresholdPx,
    handle(event) {
      if (event.type === "direction") { if (!event.repeat) runtime.enqueueAction(event.direction, performance.now()); return; }
      if (event.type === "swipe") runtime.enqueueAction(dominantDirection(event.dx, event.dy), performance.now());
    },
  });
  document.addEventListener("visibilitychange", onVisibility);
  renderInstructionText();
  onSnapshot(runtime.snapshot());
  if (storedCheckpoint !== null && runtime.snapshot().phase !== PHASE_READY) showCheckpointPrompt();

  function createRuntime(checkpoint) {
    runtime = createSnakeRuntime({ cfg, seed: parsed.seed, limitMS: durationMs, checkpoint, onSnapshot, onPump: performanceMeter.recordTick, onError });
    renderer = createSnakeRenderer({ gameZone, runtime, performanceMeter });
  }

  function onSnapshot(snapshot) {
    if (destroyed || failed || !snapshot) return;
    const enteredRunning = latestSnapshot?.phase !== PHASE_RUNNING && snapshot.phase === PHASE_RUNNING;
    latestSnapshot = snapshot;
    const phaseChanged = updateGamePhasePresentation({ gameZone, playfield, performanceMeter }, { phase: snapshot.phase, previousPhase: renderedPhase, settling: snapshot.settling });
    const timeText = unlimited ? formatElapsed(snapshot.runGT) : formatRemaining(snapshot.remainingMS);
    if (forceChrome || renderedTime !== timeText) { page.querySelector("[data-time]").textContent = timeText; renderedTime = timeText; }
    const ghostElapsed = unlimited || snapshot.phase === PHASE_ENDED ? 0 : snapshot.runGT;
    const shownGhost = unlimited ? ghostScore : Math.floor(ghostScore * Math.min(ghostElapsed, durationMs) / durationMs);
    if (forceChrome || renderedScore !== snapshot.score || renderedGhost !== shownGhost) {
      updateTugBar(page, snapshot.score, ghostScore, activeStrings, ghostElapsed, durationMs ?? 0);
      renderedScore = snapshot.score; renderedGhost = shownGhost;
    }
    if (forceChrome || renderedEnergy !== snapshot.energy) {
      updateGameBarCharge(page, { value: snapshot.energy, greenThreshold: cfg.EnergyGreenThreshold, orangeThreshold: cfg.EnergyOrangeThreshold, purpleThreshold: cfg.EnergyPurpleThreshold, label: activeLocalized.energy });
      renderedEnergy = snapshot.energy;
    }
    if (forceChrome || renderedLength !== snapshot.snake.length) { gameZone.querySelector("[data-snake-length]").textContent = String(snapshot.snake.length); renderedLength = snapshot.snake.length; }
    if (forceChrome || renderedSpeed !== snapshot.stepMS) { gameZone.querySelector("[data-snake-speed]").textContent = (1000 / snapshot.stepMS).toFixed(1); renderedSpeed = snapshot.stepMS; }
    playfield.setAttribute("aria-label", `${activeLocalized.board}. ${activeLocalized.length} ${snapshot.snake.length}. ${activeLocalized.speed} ${(1000 / snapshot.stepMS).toFixed(1)}.`);

    countdown.hidden = snapshot.phase !== PHASE_PREPARING;
    if (snapshot.phase === PHASE_PREPARING) countdown.value = String(Math.max(1, Math.ceil(snapshot.prepareRemainingMS / 1_000)));
    const button = page.querySelector(".game-button");
    if (phaseChanged || forceChrome) {
      updateGameControlButton(button, snapshot.phase, activeStrings);
      updateGameSurfaceState({ cover, playfield, overlay }, snapshot.phase);
    }
    if (enteredRunning) playfield.focus({ preventScroll: true });
    ({ input, resultView } = updateGameResultView({
      phase: snapshot.phase, resultView, input, overlay, gameIdx, game, parsed, result: snapshot.result, ghostScore,
      language: document.documentElement.lang.startsWith("zh") ? "zh" : "en", strings: activeStrings, localized: activeLocalized,
    }));
    renderedPhase = snapshot.phase;
    forceChrome = false;

    if (unlimited && snapshot.phase === PHASE_ENDED) { clearSnakeCheckpoint(parsed.code); savedCheckpointRevision = -1; }
    else if (unlimited && snapshot.checkpoint && snapshot.checkpointRevision !== savedCheckpointRevision) {
      saveSnakeCheckpoint(parsed.code, snapshot.checkpoint);
      savedCheckpointRevision = snapshot.checkpointRevision;
    }
  }

  function showCheckpointPrompt() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<section class="modal-card snake-checkpoint-dialog" role="dialog" aria-labelledby="snake-checkpoint-title">
      <h2 id="snake-checkpoint-title" data-checkpoint-title></h2><p data-checkpoint-copy></p>
      <div class="modal-actions"><button class="action-button" type="button" data-checkpoint-new></button><button class="action-button primary" type="button" data-checkpoint-continue></button></div>
    </section>`;
    const continueButton = backdrop.querySelector("[data-checkpoint-continue]");
    const newButton = backdrop.querySelector("[data-checkpoint-new]");
    const promptState = { backdrop, modal: null, setLanguage: renderCheckpointPrompt };
    checkpointPrompt = promptState;
    renderCheckpointPrompt();
    const modal = openModal(backdrop, { initialFocus: continueButton, returnFocus: page.querySelector(".game-button"), closeOnBackdrop: false, onBeforeClose: () => { if (checkpointPrompt === promptState) checkpointPrompt = null; } });
    promptState.modal = modal;
    continueButton.addEventListener("click", () => { modal.close(); checkpointPrompt = null; });
    newButton.addEventListener("click", () => {
      modal.close({ restoreFocus: false }); checkpointPrompt = null; clearSnakeCheckpoint(parsed.code); savedCheckpointRevision = -1;
      runtime.destroy(); renderer.destroy(); latestSnapshot = null; renderedPhase = null; renderedTime = null; renderedScore = null; renderedGhost = null; renderedEnergy = null; renderedLength = null; renderedSpeed = null; forceChrome = true;
      try { createRuntime(null); onSnapshot(runtime.snapshot()); } catch (error) { onError(error, "INIT"); }
    });
  }

  function renderCheckpointPrompt() {
    if (!checkpointPrompt) return;
    checkpointPrompt.backdrop.querySelector("[data-checkpoint-title]").textContent = activeLocalized.checkpointTitle;
    checkpointPrompt.backdrop.querySelector("[data-checkpoint-copy]").textContent = activeLocalized.checkpointCopy;
    checkpointPrompt.backdrop.querySelector("[data-checkpoint-new]").textContent = activeLocalized.checkpointNew;
    checkpointPrompt.backdrop.querySelector("[data-checkpoint-continue]").textContent = activeLocalized.checkpointContinue;
  }

  function renderInstructionText() {
    gameZone.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    gameZone.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    gameZone.querySelector("[data-operation-move]").textContent = activeLocalized.operationMove;
    gameZone.querySelector("[data-operation-reward]").textContent = activeLocalized.operationReward;
    gameZone.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
    gameZone.querySelector("[data-length-label]").textContent = activeLocalized.length;
    gameZone.querySelector("[data-speed-label]").textContent = activeLocalized.speed;
  }

  function onVisibility() { handleGameVisibilityChange({ hidden: document.hidden, input, runtime, renderer }); }
  function onError(error, stage = "RUNTIME") {
    failed = true;
    const failure = failGamePage({ gameID: game.gameID, stage, error, page, strings: activeStrings, visibilityHandler: onVisibility, input, renderer, runtime });
    ({ input, renderer, runtime, errorCode: failureCode } = failure);
  }

  return {
    setLanguage({ strings: nextStrings, localized: nextLocalized }) {
      activeStrings = nextStrings; activeLocalized = nextLocalized; checkpointPrompt?.setLanguage();
      if (failed) { renderControllerFailure(page, activeStrings, failureCode); return; }
      renderInstructionText(); forceChrome = true;
      resultView?.setLanguage({ language: document.documentElement.lang.startsWith("zh") ? "zh" : "en", strings: activeStrings, localized: activeLocalized });
      if (latestSnapshot) onSnapshot(latestSnapshot);
    },
    cleanup() {
      if (destroyed) return;
      destroyed = true; checkpointPrompt?.modal?.close({ restoreFocus: false }); checkpointPrompt = null;
      ({ input, renderer, runtime } = disposeGamePageResources({ visibilityHandler: onVisibility, input, renderer, runtime }));
    },
  };
}
