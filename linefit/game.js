import {
  disposeGamePageResources,
  ensureGameStylesheet,
  failGamePage,
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
import { cfg, LINEFIT_PERFORMANCE_CFG, LINEFIT_SHAPES } from "./config.js";
import { GAME_LANG } from "./lang.js";
import { createLineFitRenderer } from "./render.js";
import {
  OPERATION_IDLE,
  PHASE_ENDED,
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
  let failureCode = null;
  let forceChrome = true;
  let renderedPhase = null;
  let renderedTime = null;
  let renderedScore = null;
  let renderedGhost = null;
  let renderedEnergy = null;

  gameZone.classList.add("linefit-zone");
  gameZone.innerHTML = `
    <div class="linefit-playfield" data-linefit-playfield role="application" tabindex="-1">
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
    onError(error, "INIT");
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
    const phaseChanged = updateGamePhasePresentation({ gameZone, playfield, performanceMeter }, { phase: snapshot.phase, previousPhase: renderedPhase, settling: snapshot.settling });
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
    setLanguage({ strings: nextStrings, localized: nextLocalized }) {
      activeStrings = nextStrings;
      activeLocalized = nextLocalized;
      if (failed) {
        renderControllerFailure(page, activeStrings, failureCode);
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
      ({ input, renderer, runtime } = disposeGamePageResources({ visibilityHandler: onVisibility, input, renderer, runtime }));
    },
  };
}
