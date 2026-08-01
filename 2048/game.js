import {
  formatRemaining,
  renderControllerFailure,
  renderGameShell,
  setControlButton,
  updateTugBar,
} from "../common/game-shell.js";
import { createGameResultView } from "../common/game-result.js";
import { bindGameInput } from "../common/gesture-input.js";
import { cfg, TWENTY48_PERFORMANCE_CFG } from "./config.js";
import { dominantDirection } from "./engine.js";
import { GAME_LANG } from "./lang.js";
import { create2048Renderer, formatTileValue, getEnergyProgress } from "./render.js";
import {
  PHASE_ENDED,
  PHASE_ERROR,
  PHASE_PAUSED,
  PHASE_READY,
  PHASE_RUNNING,
  create2048Runtime,
} from "./runtime.js";

ensureStylesheet();

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
  let forceChrome = true;
  let renderedPhase = null;
  let renderedTime = null;
  let renderedScore = null;
  let renderedGhost = null;
  let renderedEnergy = null;
  let renderedScoreMultiplier = null;
  let renderedMaxTile = null;
  let renderedMoveCount = null;

  gameZone.classList.add("twenty48-zone");
  gameZone.innerHTML = `
    <div class="twenty48-playfield" data-2048-playfield role="application" tabindex="-1">
      <div class="twenty48-energy" data-energy-tier="idle">
        <div class="twenty48-energy-track" data-energy-track role="progressbar" aria-valuemin="0" aria-valuemax="${cfg.EnergyPurpleThreshold}">
          <span class="twenty48-energy-marker twenty48-energy-marker-green"></span>
          <span class="twenty48-energy-marker twenty48-energy-marker-orange"></span>
          <span class="twenty48-energy-fill" data-energy-fill><i class="twenty48-energy-head"></i></span>
        </div>
        <strong class="twenty48-energy-multiplier" data-energy-multiplier>×10.0</strong>
      </div>
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
  const energyMeter = gameZone.querySelector(".twenty48-energy");
  applyEnergyBarConfig(energyMeter);

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
    onError(error);
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
    const boardMetaChanged = forceChrome || renderedMaxTile !== snapshot.maxTile || renderedMoveCount !== snapshot.moveCount;
    if (forceChrome || renderedEnergy !== snapshot.energy || renderedScoreMultiplier !== snapshot.scoreMultiplier) {
      const energyTrack = gameZone.querySelector("[data-energy-track]");
      const tier = energyTier(snapshot.energy);
      const multiplierText = formatScoreMultiplier(snapshot.scoreMultiplier);
      energyMeter.dataset.energyTier = tier;
      energyMeter.style.setProperty("--energy-progress", String(getEnergyProgress(snapshot.energy)));
      energyTrack.setAttribute("aria-label", activeLocalized.energy);
      energyTrack.setAttribute("aria-valuenow", String(snapshot.energy));
      energyTrack.setAttribute("aria-valuetext", `${snapshot.energy}, ${multiplierText}`);
      gameZone.querySelector("[data-energy-multiplier]").textContent = multiplierText;
      renderedEnergy = snapshot.energy;
      renderedScoreMultiplier = snapshot.scoreMultiplier;
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

    if (enteredRunning) playfield.focus({ preventScroll: true });
    if (snapshot.phase === PHASE_ENDED && !resultView) {
      input?.cancelSession();
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
      runtime?.enqueuePause(performance.now());
      renderer?.setVisible(false);
    } else {
      renderer?.setVisible(true);
    }
  }

  function onError(error) {
    console.error("2048 failed", error);
    failed = true;
    input?.destroy();
    renderer?.destroy();
    runtime?.destroy();
    renderControllerFailure(page, activeStrings);
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

function formatScoreMultiplier(multiplier) {
  return `×${multiplier.toFixed(1)}`;
}

function applyEnergyBarConfig(element) {
  element.style.setProperty("--energy-idle-color", cfg.EnergyBarIdleColor);
  element.style.setProperty("--energy-green-color", cfg.EnergyBarGreenColor);
  element.style.setProperty("--energy-orange-color", cfg.EnergyBarOrangeColor);
  element.style.setProperty("--energy-purple-color", cfg.EnergyBarPurpleColor);
  element.style.setProperty("--energy-bar-height", `${cfg.EnergyBarHeightPx}px`);
  element.style.setProperty("--energy-multiplier-width", `${cfg.EnergyBarMultiplierWidthPx}px`);
  element.style.setProperty("--energy-arc-ms", `${cfg.EnergyBarArcMS}ms`);
  element.style.setProperty("--energy-transition-ms", `${cfg.EnergyBarTransitionMS}ms`);
}
