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
import { getPreference, setPreference } from "../common/storage.js";
import { clearLineFitCheckpoint, loadLineFitCheckpoint, saveLineFitCheckpoint } from "./checkpoint.js";
import { cfg, LINEFIT_PERFORMANCE_CFG, LINEFIT_SHAPES } from "./config.js";
import { GAME_LANG } from "./lang.js";
import { createLineFitRenderer } from "./render.js";
import {
  OPERATION_IDLE,
  PHASE_ENDED,
  PHASE_READY,
  PHASE_RUNNING,
  createLineFitRuntime,
} from "./runtime.js";

ensureGameStylesheet(import.meta.url);

export function renderGamePage(mount, context) {
  renderGameShell(mount, {
    ...context,
    gameStrings: GAME_LANG,
    setupGame: setupLineFit,
    performanceMeterCfg: LINEFIT_PERFORMANCE_CFG,
  });
}

function setupLineFit({ page, gameZone, game, gameIdx, parsed, durationMs, unlimited, ghostScore, strings, localized, gameBarTourActive, performanceMeter }) {
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
  let savedCheckpointRevision = -1;
  let checkpointPrompt = null;
  let checkpointHandled = false;
  let styleSelection = "colorful";
  let gameBarTourDone = !gameBarTourActive;

  gameZone.classList.add("linefit-zone");
  gameZone.innerHTML = `
    <div class="linefit-playfield" data-linefit-playfield role="application" tabindex="-1">
      <div class="linefit-board" data-linefit-board aria-hidden="true">
        <div class="linefit-grid" data-linefit-grid></div>
      </div>
      <div class="linefit-tray" data-linefit-tray></div>
    </div>
    <div class="linefit-cover" data-linefit-cover>
      <section class="linefit-style-chooser" data-linefit-style-chooser role="dialog" aria-labelledby="linefit-style-title" hidden>
        <h1 id="linefit-style-title" data-style-title></h1>
        <div class="linefit-style-options" role="radiogroup" data-style-options></div>
        <p data-style-copy></p>
        <button class="action-button primary linefit-style-confirm" type="button" data-style-confirm></button>
      </section>
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
  const rulesCard = cover.querySelector(".linefit-rules");
  const styleChooser = cover.querySelector("[data-linefit-style-chooser]");
  const overlay = gameZone.querySelector("[data-linefit-overlay]");
  styleChooser.querySelector("[data-style-options]").innerHTML = ["colorful", "duotone"]
    .map((styleID) => `<button class="linefit-style-option" type="button" role="radio" data-style-option="${styleID}">${stylePreviewMarkup(styleID)}<strong data-style-label></strong></button>`)
    .join("");
  styleChooser.querySelectorAll("[data-style-option]").forEach((option) => option.addEventListener("click", () => {
    styleSelection = option.dataset.styleOption;
    paintStyleSelection();
  }));
  styleChooser.querySelector("[data-style-confirm]").addEventListener("click", confirmStyleSelection);

  const storedCheckpoint = unlimited ? loadLineFitCheckpoint(parsed.code) : null;
  try {
    createRuntime(storedCheckpoint);
  } catch (restoreError) {
    if (storedCheckpoint === null) {
      onError(restoreError, "INIT");
      return { cleanup() {} };
    }
    clearLineFitCheckpoint(parsed.code);
    try {
      createRuntime(null);
    } catch (error) {
      onError(error, "INIT");
      return { cleanup() {} };
    }
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
  renderStyleChooserText();
  onSnapshot(runtime.snapshot());
  if (gameBarTourDone) continueEntryFlow();

  function createRuntime(checkpoint) {
    runtime = createLineFitRuntime({
      cfg,
      shapes: LINEFIT_SHAPES,
      seed: parsed.seed,
      limitMS: durationMs,
      checkpoint,
      onSnapshot,
      onPump: performanceMeter.recordTick,
      onError,
    });
    renderer = createLineFitRenderer({ gameZone, runtime, performanceMeter });
  }

  function onSnapshot(snapshot) {
    if (destroyed || failed || !snapshot) return;
    const enteredRunning = latestSnapshot?.phase !== PHASE_RUNNING && snapshot.phase === PHASE_RUNNING;
    latestSnapshot = snapshot;
    const phaseChanged = updateGamePhasePresentation({ gameZone, playfield, performanceMeter }, { phase: snapshot.phase, previousPhase: renderedPhase, settling: snapshot.settling });
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
    const button = page.querySelector(".game-button");
    if (phaseChanged || forceChrome) {
      updateGameControlButton(button, snapshot.phase, activeStrings);
      updateGameSurfaceState({ cover, playfield, overlay }, snapshot.phase);
    }
    if (!styleChooser.hidden) button.disabled = true;

    if (snapshot.phase !== PHASE_RUNNING || snapshot.operation !== OPERATION_IDLE) {
      input?.cancelSession();
      renderer?.cancelDrag();
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
      clearLineFitCheckpoint(parsed.code);
      savedCheckpointRevision = -1;
    } else if (unlimited && snapshot.checkpoint && snapshot.checkpointRevision !== savedCheckpointRevision) {
      saveLineFitCheckpoint(parsed.code, snapshot.checkpoint);
      savedCheckpointRevision = snapshot.checkpointRevision;
    }
  }

  function continueEntryFlow() {
    if (!gameBarTourDone) return true;
    if (getPreference("linefitUIStyleChosen", "") !== "1") {
      showStyleChooser();
      return false;
    }
    if (!checkpointHandled && storedCheckpoint !== null && runtime.snapshot().phase !== PHASE_READY) {
      checkpointHandled = true;
      showCheckpointPrompt();
    }
    return true;
  }

  function showStyleChooser() {
    styleSelection = getPreference("linefitUIStyle", "colorful") === "duotone" ? "duotone" : "colorful";
    rulesCard.hidden = true;
    styleChooser.hidden = false;
    paintStyleSelection();
    page.querySelector(".game-button").disabled = true;
    requestAnimationFrame(() => styleChooser.querySelector('[data-style-option="colorful"]')?.focus({ preventScroll: true }));
  }

  function confirmStyleSelection() {
    setPreference("linefitUIStyle", styleSelection);
    setPreference("linefitUIStyleChosen", "1");
    styleChooser.hidden = true;
    rulesCard.hidden = false;
    const button = page.querySelector(".game-button");
    if (latestSnapshot) updateGameControlButton(button, latestSnapshot.phase, activeStrings);
    if (!checkpointHandled && storedCheckpoint !== null && runtime.snapshot().phase !== PHASE_READY) {
      checkpointHandled = true;
      showCheckpointPrompt();
    } else {
      button.focus({ preventScroll: true });
    }
  }

  function paintStyleSelection() {
    styleChooser.querySelectorAll("[data-style-option]").forEach((option) => {
      option.setAttribute("aria-checked", String(option.dataset.styleOption === styleSelection));
    });
  }

  function renderStyleChooserText() {
    styleChooser.querySelector("[data-style-title]").textContent = activeLocalized.uiStyleTitle;
    styleChooser.querySelector('[data-style-option="colorful"] [data-style-label]').textContent = activeLocalized.uiStyleColorful;
    styleChooser.querySelector('[data-style-option="duotone"] [data-style-label]').textContent = activeLocalized.uiStyleDuotone;
    styleChooser.querySelector("[data-style-copy]").textContent = activeLocalized.uiStyleCopy;
    styleChooser.querySelector("[data-style-confirm]").textContent = activeLocalized.uiStyleConfirm;
  }

  function showCheckpointPrompt() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <section class="modal-card linefit-checkpoint-dialog" role="dialog" aria-labelledby="linefit-checkpoint-title">
        <h2 id="linefit-checkpoint-title" data-checkpoint-title></h2>
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
      clearLineFitCheckpoint(parsed.code);
      savedCheckpointRevision = -1;
      runtime.destroy();
      renderer.destroy();
      latestSnapshot = null;
      renderedPhase = null;
      renderedTime = null;
      renderedScore = null;
      renderedGhost = null;
      renderedEnergy = null;
      forceChrome = true;
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
    handleGameVisibilityChange({ hidden: document.hidden, input, runtime, renderer, onHide: () => renderer?.cancelDrag() });
  }

  function onError(error, stage = "RUNTIME") {
    failed = true;
    const failure = failGamePage({ gameID: game.gameID, stage, error, page, strings: activeStrings, visibilityHandler: onVisibility, input, renderer, runtime });
    ({ input, renderer, runtime, errorCode: failureCode } = failure);
  }

  function renderInstructionText() {
    gameZone.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    gameZone.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    gameZone.querySelector("[data-operation-place]").textContent = activeLocalized.operationPlace;
    gameZone.querySelector("[data-operation-batch]").textContent = activeLocalized.operationBatch;
    gameZone.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
    playfield.setAttribute("aria-label", activeLocalized.board);
  }

  return {
    onGameBarTourDone() {
      gameBarTourDone = true;
      return continueEntryFlow();
    },
    setLanguage({ strings: nextStrings, localized: nextLocalized }) {
      activeStrings = nextStrings;
      activeLocalized = nextLocalized;
      checkpointPrompt?.setLanguage();
      if (failed) {
        renderControllerFailure(page, activeStrings, failureCode);
        return;
      }
      renderInstructionText();
      renderStyleChooserText();
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
      checkpointPrompt?.modal?.close({ restoreFocus: false });
      checkpointPrompt = null;
      ({ input, renderer, runtime } = disposeGamePageResources({ visibilityHandler: onVisibility, input, renderer, runtime }));
    },
  };
}

function stylePreviewMarkup(styleID) {
  const occupied = new Set([1, 2, 5, 6, 7, 10, 12, 13, 14, 17, 18, 19, 23, 24]);
  let colorIndex = 0;
  return `<span class="linefit-style-board" data-preview-style="${styleID}" aria-hidden="true">${Array.from({ length: 25 }, (_, index) => {
    if (!occupied.has(index)) return "<i></i>";
    return `<i class="is-piece preview-color-${colorIndex++ % 6}"></i>`;
  }).join("")}</span>`;
}
