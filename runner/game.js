import {
  formatRemaining,
  renderControllerFailure,
  renderGameShell,
  setControlButton,
  updateTugBar,
} from "../common/game-shell.js";
import { createGameResultView } from "../common/game-result.js";
import { bindGameInput } from "../common/gesture-input.js";
import { cfg, RUNNER_OBJECTS, RUNNER_PERFORMANCE_CFG } from "./config.js";
import { GAME_LANG } from "./lang.js";
import { createRunnerRenderer } from "./render.js";
import { generateRoad } from "./road.js";
import {
  PHASE_ENDED,
  PHASE_ERROR,
  PHASE_PAUSED,
  PHASE_PREPARING,
  PHASE_READY,
  PHASE_RUNNING,
  createRunnerRuntime,
} from "./runtime.js";
import { RUNNER_SVG, runnerSymbolMarkup } from "./svg.js";

ensureStylesheet();

export function renderGamePage(mount, context) {
  renderGameShell(mount, {
    ...context,
    gameStrings: GAME_LANG,
    setupGame: setupRunner,
    performanceMeterCfg: RUNNER_PERFORMANCE_CFG,
  });
}

function setupRunner({ page, gameZone, game, gameIdx, parsed, durationMs, ghostScore, strings, localized, performanceMeter }) {
  let activeStrings = strings;
  let activeLocalized = localized;
  let latestSnapshot = null;
  let resultView = null;
  let runnerInput = null;
  let renderer = null;
  let runtime = null;
  let destroyed = false;
  let failed = false;

  gameZone.classList.add("runner-zone");
  gameZone.innerHTML = `
    <div class="runner-playfield" data-runner-playfield role="application" tabindex="-1">
      <svg class="runner-scene" data-runner-scene viewBox="0 0 600 760" role="img" aria-label="${activeLocalized.road}">
        <defs>${runnerSymbolMarkup()}</defs>
        <path class="runner-sky" d="M0 0H600V760H0Z"/>
        <path class="runner-road" d="M245 145H355L565 760H35Z"/>
        <path class="runner-edge" d="M245 145L35 760M355 145L565 760"/>
        <path class="runner-lane-line" d="M282 145L212 760M318 145L388 760"/>
        <g data-road-objects></g>
        <use class="runner-motorcycle" data-motorcycle x="-48" y="-96" width="96" height="144" href="#runner-motorcycle"/>
        <g class="runner-hearts" aria-hidden="true">
          <use data-runner-heart x="18" y="20" width="42" height="38" href="#runner-heart"/>
          <use data-runner-heart x="65" y="20" width="42" height="38" href="#runner-heart"/>
          <use data-runner-heart x="112" y="20" width="42" height="38" href="#runner-heart"/>
        </g>
      </svg>
      <div class="runner-speed" data-runner-speed aria-live="polite">1.00×</div>
    </div>
    <div class="runner-cover" data-runner-cover>
      <div class="rules-card runner-rules">
        <h1 data-instructions-title></h1>
        <p data-rules-copy></p>
        <ol><li data-operation-steer></li><li data-operation-objects></li><li data-operation-score></li></ol>
      </div>
    </div>
    <div class="runner-overlay game-result-overlay" data-runner-overlay hidden></div>
    <output class="countdown" data-countdown hidden></output>
  `;

  const playfield = gameZone.querySelector("[data-runner-playfield]");
  const scene = gameZone.querySelector("[data-runner-scene]");
  const cover = gameZone.querySelector("[data-runner-cover]");
  const overlay = gameZone.querySelector("[data-runner-overlay]");
  const countdown = gameZone.querySelector("[data-countdown]");
  gameZone.append(performanceMeter.element);

  try {
    const road = generateRoad({ seed: parsed.seed, limitMS: durationMs, cfg, objects: RUNNER_OBJECTS, svg: RUNNER_SVG });
    runtime = createRunnerRuntime({
      cfg,
      objects: RUNNER_OBJECTS,
      road,
      limitMS: durationMs,
      onSnapshot,
      onPump: performanceMeter.recordTick,
      onError,
    });
    renderer = createRunnerRenderer({
      gameZone,
      road,
      objects: RUNNER_OBJECTS,
      runtime,
      performanceMeter,
    });
  } catch (error) {
    onError(error);
    return { cleanup() {} };
  }

  page.querySelector(".game-button").addEventListener("click", () => runtime.enqueueGameBarClick(performance.now()));
  runnerInput = bindGameInput(playfield, {
    recognizer: "axis-swipe",
    axis: "x",
    thresholdPx: cfg.SwipeThresholdPx,
    handle(inputEvent) {
      if (inputEvent.type !== "swipe" && inputEvent.type !== "direction") return;
      runtime.enqueueAction(inputEvent.direction === "west" ? -1 : 1, performance.now());
    },
  });
  document.addEventListener("visibilitychange", onVisibility);
  renderInstructionText();
  onSnapshot(runtime.snapshot());

  function onSnapshot(snapshot) {
    if (destroyed || failed || !snapshot) return;
    const enteredRunning = latestSnapshot?.phase !== PHASE_RUNNING && snapshot.phase === PHASE_RUNNING;
    latestSnapshot = snapshot;
    performanceMeter.setPhase(snapshot.phase);
    gameZone.dataset.phase = snapshot.phase;
    page.querySelector("[data-time]").textContent = formatRemaining(snapshot.remainingMS);
    const ghostElapsed = snapshot.phase === PHASE_ENDED ? durationMs : snapshot.runGT;
    updateTugBar(page, snapshot.runScore, ghostScore, activeStrings, ghostElapsed, durationMs);
    const button = page.querySelector(".game-button");
    if (snapshot.phase === PHASE_READY) {
      button.disabled = false;
      setControlButton(button, "play", activeStrings.start);
    } else if (snapshot.phase === PHASE_PREPARING) {
      button.disabled = true;
      setControlButton(button, "clock", activeStrings.ready);
    } else if (snapshot.phase === PHASE_RUNNING) {
      button.disabled = false;
      setControlButton(button, "pause", activeStrings.pause);
    } else if (snapshot.phase === PHASE_PAUSED) {
      button.disabled = false;
      setControlButton(button, "play", activeStrings.resume);
    } else if (snapshot.phase === PHASE_ENDED) {
      button.disabled = true;
      setControlButton(button, "finish", activeStrings.finished);
    }
    countdown.hidden = snapshot.phase !== PHASE_PREPARING;
    if (snapshot.phase === PHASE_PREPARING) countdown.value = String(Math.max(1, Math.ceil(snapshot.prepareRemainingMS / 1_000)));
    cover.hidden = snapshot.phase === PHASE_RUNNING || snapshot.phase === PHASE_ENDED;
    playfield.tabIndex = snapshot.phase === PHASE_RUNNING ? 0 : -1;
    playfield.setAttribute("aria-disabled", String(snapshot.phase !== PHASE_RUNNING));
    if (enteredRunning) playfield.focus({ preventScroll: true });
    overlay.hidden = snapshot.phase !== PHASE_ENDED;
    if (snapshot.phase === PHASE_ENDED && !resultView) {
      runnerInput?.cancelSession();
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
  }

  function onVisibility() {
    if (document.hidden) {
      runnerInput?.cancelSession();
      runtime?.enqueuePause(performance.now());
      renderer?.setVisible(false);
    } else {
      renderer?.setVisible(true);
    }
  }

  function onError(error) {
    console.error("Runner failed", error);
    failed = true;
    runnerInput?.destroy();
    renderer?.destroy();
    runtime?.destroy();
    renderControllerFailure(page, activeStrings);
  }

  function renderInstructionText() {
    scene.setAttribute("aria-label", activeLocalized.road);
    playfield.setAttribute("aria-label", `${activeLocalized.road}. ${activeLocalized.steer}`);
    gameZone.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    gameZone.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    gameZone.querySelector("[data-operation-steer]").textContent = activeLocalized.operationSteer;
    gameZone.querySelector("[data-operation-objects]").textContent = activeLocalized.operationObjects;
    gameZone.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
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
      runnerInput?.destroy();
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
