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
import { cfg, TWENTY48_PERFORMANCE_CFG } from "./config.js";
import { dominantDirection } from "./engine.js";
import { GAME_LANG } from "./lang.js";
import { create2048Renderer, formatTileValue } from "./render.js";
import {
  PHASE_ENDED,
  PHASE_RUNNING,
  create2048Runtime,
} from "./runtime.js";

ensureGameStylesheet(import.meta.url);

export function renderGamePage(mount, context) {
  renderGameShell(mount, {
    ...context,
    gameStrings: GAME_LANG,
    setupGame: setup2048,
    performanceMeterCfg: TWENTY48_PERFORMANCE_CFG,
  });
}

function setup2048({ page, gameZone, game, gameIdx, parsed, durationMs, ghostScore, strings, localized, performanceMeter }) {
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
  let renderedMaxTile = null;
  let renderedMoveCount = null;

  gameZone.classList.add("twenty48-zone");
  gameZone.innerHTML = `
    <div class="twenty48-playfield" data-2048-playfield role="application" tabindex="-1">
      <div class="twenty48-hud">
        <span><span data-max-label></span><strong data-max-tile>0</strong></span>
        <span><span data-moves-label></span><strong data-move-count>0</strong></span>
      </div>
      <div class="twenty48-board" data-2048-board aria-hidden="true">
        <div class="twenty48-grid" data-2048-grid></div>
        <div class="twenty48-static" data-2048-static></div>
        <div class="twenty48-motion" data-2048-motion></div>
      </div>
    </div>
    <div class="twenty48-cover" data-2048-cover>
      <div class="rules-card twenty48-rules">
        <h1 data-instructions-title></h1>
        <p data-rules-copy></p>
        <ol><li data-operation-move></li><li data-operation-spawn></li><li data-operation-score></li></ol>
      </div>
    </div>
    <div class="twenty48-overlay game-result-overlay" data-2048-overlay hidden></div>
  `;

  const playfield = gameZone.querySelector("[data-2048-playfield]");
  const cover = gameZone.querySelector("[data-2048-cover]");
  const overlay = gameZone.querySelector("[data-2048-overlay]");

  try {
    runtime = create2048Runtime({
      cfg,
      seed: parsed.seed,
      limitMS: durationMs,
      onSnapshot,
      onPump: performanceMeter.recordTick,
      onError,
    });
    renderer = create2048Renderer({ gameZone, runtime, performanceMeter });
  } catch (error) {
    onError(error, "INIT");
    return { cleanup() {} };
  }

  page.querySelector(".game-button").addEventListener("click", () => runtime.enqueueGameBarClick(performance.now()));
  input = bindGameInput(gameZone, {
    recognizer: "swipe",
    thresholdPx: cfg.SwipeThresholdPx,
    handle(inputEvent) {
      if (inputEvent.type === "direction") {
        if (!inputEvent.repeat) runtime.enqueueAction(inputEvent.direction, performance.now());
        return;
      }
      if (inputEvent.type !== "swipe") return;
      runtime.enqueueAction(dominantDirection(inputEvent.dx, inputEvent.dy), performance.now());
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
    const boardMetaChanged = forceChrome || renderedMaxTile !== snapshot.maxTile || renderedMoveCount !== snapshot.moveCount;
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
    if (forceChrome || renderedMaxTile !== snapshot.maxTile) {
      gameZone.querySelector("[data-max-tile]").textContent = formatTileValue(snapshot.maxTile);
      renderedMaxTile = snapshot.maxTile;
    }
    if (forceChrome || renderedMoveCount !== snapshot.moveCount) {
      gameZone.querySelector("[data-move-count]").textContent = String(snapshot.moveCount);
      renderedMoveCount = snapshot.moveCount;
    }
    if (boardMetaChanged) {
      playfield.setAttribute("aria-label", `${activeLocalized.board}. ${activeLocalized.maxTile} ${formatTileValue(snapshot.maxTile)}. ${activeLocalized.moves} ${snapshot.moveCount}.`);
    }

    const button = page.querySelector(".game-button");
    if (phaseChanged || forceChrome) {
      updateGameControlButton(button, snapshot.phase, activeStrings);
      updateGameSurfaceState({ cover, playfield, overlay }, snapshot.phase);
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
    gameZone.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    gameZone.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    gameZone.querySelector("[data-operation-move]").textContent = activeLocalized.operationMove;
    gameZone.querySelector("[data-operation-spawn]").textContent = activeLocalized.operationSpawn;
    gameZone.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
    gameZone.querySelector("[data-max-label]").textContent = activeLocalized.maxTile;
    gameZone.querySelector("[data-moves-label]").textContent = activeLocalized.moves;
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
