import { renderHeader } from "./header.js";
import { emitEventSignal } from "./event-signal.js";
import { iconMarkup } from "./icons.js";
import { parseICode } from "./icode.js";
import { readResultScore } from "./result-code.js";
import { SCORE_MAX } from "./protocol-constants.js";
import { LANG } from "../lang.js";
import { PHASE_ENDED, PHASE_INTRO, PHASE_PAUSED, PHASE_PREPARING, PHASE_RUNNING, PHASE_SETTLING } from "./game-controller.js";
import { createPerformanceMeter } from "./performance-meter.js";
import { createGameBarTour } from "./game-bar-tour.js";

export function renderGameShell(mount, { game, gameIdx, params, version, gameStrings, setupGame, performanceMeterCfg }) {
  mount.replaceChildren();
  let cleanup = () => {};
  let cleanupHeader = () => {};
  let tourBinding = null;
  let gameBinding = null;
  let languageBinding = null;
  const dispose = () => {
    tourBinding?.destroy();
    cleanup();
    cleanupHeader();
    removeEventListener("zuben:navigate-home", dispose);
    removeEventListener("popstate", dispose);
  };
  addEventListener("zuben:navigate-home", dispose, { once: true });
  addEventListener("popstate", dispose, { once: true });
  const headerBinding = renderHeader(mount, {
    version,
    gameID: game.gameID,
    showPerformanceMeter: true,
    onLanguageChange: (nextLanguage) => languageBinding?.(nextLanguage),
  });
  const { language, strings } = headerBinding;
  cleanupHeader = headerBinding.cleanup;
  const localized = gameStrings[language] ?? gameStrings.en;
  const challengeCode = params.get("c");
  const parsed = { ...parseICode(challengeCode), code: challengeCode };

  if (params.getAll("c").length !== 1 || !parsed.ok || !game.durs[parsed.durIdx]) {
    const error = document.createElement("main");
    error.className = "game-error";
    error.innerHTML = `<h1>${strings.invalidChallenge}</h1><p>${strings.invalidChallengeHint}</p>`;
    mount.append(error);
    languageBinding = (nextLanguage) => {
      const nextStrings = LANG[nextLanguage] ?? LANG.en;
      error.innerHTML = `<h1>${nextStrings.invalidChallenge}</h1><p>${nextStrings.invalidChallengeHint}</p>`;
    };
    return;
  }

  const duration = game.durs[parsed.durIdx];
  const unlimited = duration > 9_000;
  const durationMs = unlimited ? null : duration * 1_000;
  const emitBeacon = (event) => emitEventSignal({ gameID: game.gameID, timeS: duration, event });
  const ghostScore = readResultScore(params, game.gameID, parsed.code, game.scoreVersion);
  const page = document.createElement("main");
  page.className = "game-page game-page-fixed-ui";
  page.dataset.unlimited = String(unlimited);
  const timeLabel = unlimited ? strings.elapsed : strings.time;
  page.innerHTML = `
    <section class="game-bar" aria-label="${strings.gameStatus}">
      <div class="status-metric time-metric" title="${timeLabel}">
        <span class="visually-hidden">${timeLabel}</span><strong data-time>${unlimited ? formatElapsed(0) : formatRemaining(durationMs)}</strong>
      </div>
      <button class="game-button" type="button" data-control-state="play" aria-label="${strings.start}" title="${strings.start}"><span class="crystal-button-label">${strings.start}</span></button>
      <div class="status-metric score-metric" title="${strings.score}">
        <span class="visually-hidden">${strings.score}</span><strong data-score>0</strong>
      </div>
      <div class="tug-bar" data-tug role="img">
        <span class="tug-side tug-self"><i class="tug-fill tug-self-fill"></i></span>
        <span class="tug-center" aria-hidden="true"></span>
        <span class="tug-side tug-ghost"><i class="tug-fill tug-ghost-fill"></i></span>
      </div>
      <div class="status-metric ghost-metric" title="${strings.ghost}">
        <span class="visually-hidden">${strings.ghost}</span><strong data-ghost>${ghostScore}</strong>
      </div>
      <div class="game-bar-charge" data-game-bar-charge data-charge-tier="idle" aria-hidden="true">
        <span class="game-bar-charge-fill"></span>
      </div>
    </section>
    <section class="game-zone" data-game-zone>
      <output class="countdown" data-countdown hidden></output>
    </section>
  `;
  mount.append(page);
  page.querySelector(".game-button").addEventListener("click", () => {
    if (page.querySelector("[data-game-zone]")?.dataset.phase === PHASE_ENDED) location.reload();
  });
  updateTugBar(page, 0, ghostScore, strings, 0, durationMs ?? 0);
  tourBinding = createGameBarTour(page, strings, { unlimited, onDone: () => gameBinding?.onGameBarTourDone?.() });
  if (setupGame) {
    const performanceMeter = createPerformanceMeter(headerBinding.performanceMeterHost, performanceMeterCfg);
    let startBeaconSent = false;
    const trackedPerformanceMeter = Object.freeze({
      ...performanceMeter,
      setPhase(nextPhase) {
        performanceMeter.setPhase(nextPhase);
        if (!startBeaconSent && nextPhase === PHASE_RUNNING) {
          startBeaconSent = true;
          emitBeacon("startGame");
        }
      },
    });
    const binding = setupGame({
      page,
      gameZone: page.querySelector("[data-game-zone]"),
      parsed,
      game,
      gameIdx,
      durationMs,
      unlimited,
      ghostScore,
      strings,
      localized,
      gameBarTourActive: tourBinding.active,
      performanceMeter: trackedPerformanceMeter,
    });
    gameBinding = binding;
    emitBeacon("openLink");
    if (typeof binding === "function") cleanup = () => { binding(); performanceMeter.destroy(); };
    else if (binding) {
      cleanup = () => { binding.cleanup?.(); performanceMeter.destroy(); };
      languageBinding = (nextLanguage) => {
        const nextStrings = LANG[nextLanguage] ?? LANG.en;
        const nextLocalized = gameStrings[nextLanguage] ?? gameStrings.en;
        updateGameChromeLanguage(page, nextStrings, unlimited);
        tourBinding?.setLanguage(nextStrings);
        const gameZone = page.querySelector("[data-game-zone]");
        if (gameZone?.dataset.phase === "PHASE_ERROR") renderControllerFailure(page, nextStrings, gameZone.dataset.errorCode);
        binding.setLanguage?.({ language: nextLanguage, strings: nextStrings, localized: nextLocalized });
      };
    } else {
      cleanup = () => performanceMeter.destroy();
    }
    return;
  }

  page.querySelector("[data-game-zone]").insertAdjacentHTML("afterbegin", `
    ${iconMarkup(game.gameID, "game-zone-icon")}
    <h1>${localized.name}</h1>
    <p>${strings.gamePlaceholder}</p>
    <div class="rules-card" data-rules><span>${strings.rules}</span><p>${localized.rules}</p></div>
  `);
  connectClock(page, duration, strings);
  languageBinding = () => {
    dispose();
    renderGameShell(mount, { game, params, version, gameStrings, setupGame });
  };
}

function connectClock(page, durationSeconds, strings) {
  const button = page.querySelector(".game-button");
  const time = page.querySelector("[data-time]");
  const rules = page.querySelector("[data-rules]");
  const countdown = page.querySelector("[data-countdown]");
  let phase = "intro";
  let elapsed = 0;
  let anchor = 0;
  let frame = 0;

  const paint = (now) => {
    if (phase !== "running") return;
    const total = elapsed + now - anchor;
    const remaining = Math.max(0, durationSeconds * 1000 - total);
    time.textContent = formatRemaining(remaining);
    if (remaining === 0) {
      phase = "finished";
      button.disabled = true;
      setControlButton(button, "finish", strings.finished);
      return;
    }
    frame = requestAnimationFrame(paint);
  };

  const prepare = () => {
    phase = "preparing";
    rules.hidden = true;
    button.disabled = true;
    setControlButton(button, "clock", strings.ready);
    countdown.hidden = false;
    let count = 3;
    countdown.value = count;
    const timer = setInterval(() => {
      count -= 1;
      if (count > 0) {
        countdown.value = count;
        return;
      }
      clearInterval(timer);
      countdown.hidden = true;
      phase = "running";
      anchor = performance.now();
      button.disabled = false;
      setControlButton(button, "pause", strings.pause);
      frame = requestAnimationFrame(paint);
    }, 500);
  };

  button.addEventListener("click", () => {
    if (phase === "intro") {
      prepare();
    } else if (phase === "running") {
      elapsed += performance.now() - anchor;
      phase = "paused";
      cancelAnimationFrame(frame);
      setControlButton(button, "play", strings.resume);
    } else if (phase === "paused") {
      prepare();
    }
  });
}

export function ensureGameStylesheet(moduleUrl) {
  const href = new URL("./game.css", moduleUrl).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}

export function updateGameSurfaceState({ cover, playfield, overlay }, phase) {
  const running = phase === "PHASE_RUNNING";
  const ended = phase === "PHASE_ENDED";
  cover.hidden = running || ended;
  overlay.hidden = !ended;
  if (playfield) {
    playfield.tabIndex = running ? 0 : -1;
    playfield.setAttribute("aria-disabled", String(!running));
  }
}

export function updateGamePhasePresentation({ gameZone, playfield, performanceMeter }, { phase, previousPhase, settling }) {
  playfield.classList.toggle("deadline-settlement", Boolean(settling));
  const phaseChanged = phase !== previousPhase;
  if (phaseChanged) {
    performanceMeter.setPhase(phase);
    gameZone.dataset.phase = phase;
  }
  return phaseChanged;
}

export function handleGameVisibilityChange({ hidden, input, runtime, renderer, onHide, getBN = () => performance.now() }) {
  if (hidden) {
    input?.cancelSession();
    onHide?.();
    runtime?.enqueuePause(getBN());
  }
  renderer?.setVisible(!hidden);
}

export function createGameErrorCode(gameID, stage) {
  if (!/^[a-z0-9]+$/i.test(gameID)) throw new TypeError("gameID must be alphanumeric");
  if (stage !== "INIT" && stage !== "RUNTIME") throw new RangeError("stage must be INIT or RUNTIME");
  return `ZB-${gameID.toUpperCase()}-${stage}`;
}

export function disposeGamePageResources({ visibilityHandler, input, renderer, runtime, eventTarget = document, errorCode = "ZB-CLEANUP" }) {
  if (visibilityHandler) eventTarget.removeEventListener("visibilitychange", visibilityHandler);
  for (const [name, resource] of [["input", input], ["renderer", renderer], ["runtime", runtime]]) {
    try {
      resource?.destroy();
    } catch (error) {
      console.error(`[${errorCode}] Could not destroy ${name}`, error);
    }
  }
  return { input: null, renderer: null, runtime: null };
}

export function failGamePage({ gameID, stage, error, page, strings, visibilityHandler, input, renderer, runtime }) {
  const errorCode = createGameErrorCode(gameID, stage);
  console.error(`[${errorCode}] GamePage failed`, error);
  const resources = disposeGamePageResources({ visibilityHandler, input, renderer, runtime, errorCode });
  renderControllerFailure(page, strings, errorCode);
  return { ...resources, errorCode };
}

export function updateGameControlButton(button, phase, strings) {
  let disabled;
  let state;
  let label;
  if (phase === "PHASE_READY") {
    disabled = false;
    state = "play";
    label = strings.start;
  } else if (phase === "PHASE_PREPARING") {
    disabled = true;
    state = "clock";
    label = strings.ready;
  } else if (phase === "PHASE_RUNNING") {
    disabled = false;
    state = "pause";
    label = strings.pause;
  } else if (phase === "PHASE_PAUSED") {
    disabled = false;
    state = "play";
    label = strings.resume;
  } else if (phase === "PHASE_ENDED") {
    disabled = false;
    state = "play";
    label = strings.tryAgain;
  } else if (phase === "PHASE_ERROR") {
    disabled = true;
    state = "finish";
    label = strings.failed;
  } else {
    return false;
  }
  button.disabled = disabled;
  setControlButton(button, state, label);
  return true;
}

function setControlButton(button, state, label) {
  button.querySelector(".crystal-button-label").textContent = label;
  button.dataset.controlState = state;
  button.setAttribute("aria-label", label);
  button.title = label;
}

export function formatRemaining(milliseconds) {
  const tenths = Math.min(9_999, milliseconds <= 0 ? 0 : Math.ceil(milliseconds / 100));
  return `${(tenths / 10).toFixed(1)}s`;
}

export function formatElapsed(milliseconds) {
  const totalSeconds = milliseconds <= 0 ? 0 : Math.floor(milliseconds / 1_000);
  if (totalSeconds > 999 * 60 + 59) return "999:99";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(3, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function updateTugBar(page, ownScore, ghostScore, strings, elapsedMs = 0, limitMs = 0) {
  const bar = page.querySelector("[data-tug]");
  const tug = calculateTugState(ownScore, ghostScore, elapsedMs, limitMs);

  page.querySelector("[data-score]").textContent = String(tug.ownScore);
  page.querySelector("[data-ghost]").textContent = String(tug.ghostScore);
  bar.dataset.leader = tug.leader;
  bar.style.setProperty("--self-share", String(tug.selfShare));
  bar.style.setProperty("--ghost-share", String(tug.ghostShare));
  const status = tug.ownScore === tug.ghostScore
    ? strings.tugTied
    : tug.leader === "self" ? strings.tugYouLead : strings.tugGhostLeads;
  bar.setAttribute("aria-label", `${strings.score} ${tug.ownScore}, ${strings.ghost} ${tug.ghostScore}. ${status}`);
}

export function calculateTugState(ownScore, ghostFinalScore, elapsedMs, limitMs) {
  const own = normalizeScore(ownScore);
  const ghostFinal = normalizeScore(ghostFinalScore);
  const limit = Math.max(0, Math.trunc(Number(limitMs) || 0));
  const elapsed = Math.min(limit, Math.max(0, Math.trunc(Number(elapsedMs) || 0)));
  const ghost = limit === 0 ? ghostFinal : Math.floor(ghostFinal * elapsed / limit);
  const total = own + ghost;
  const selfShare = total === 0 ? 0.5 : own / total;
  return Object.freeze({
    ownScore: own,
    ghostScore: ghost,
    selfShare,
    ghostShare: 1 - selfShare,
    leader: own >= ghost ? "self" : "ghost",
  });
}

function normalizeScore(value) {
  return Math.min(SCORE_MAX, Math.max(0, Math.trunc(Number(value) || 0)));
}

export function renderControllerStatus(page, snapshot, ghostScore, strings) {
  page.querySelector("[data-time]").textContent = formatRemaining(snapshot.remainingMs);
  updateTugBar(page, snapshot.game.score, ghostScore, strings, snapshot.raceTimeMs, snapshot.raceTimeMs + snapshot.remainingMs);
  const button = page.querySelector(".game-button");
  const countdown = page.querySelector("[data-countdown]");
  countdown.hidden = snapshot.phase !== PHASE_PREPARING;
  if (snapshot.phase === PHASE_PREPARING) countdown.value = snapshot.countdown;

  if (snapshot.phase === PHASE_INTRO) {
    button.disabled = false;
    setControlButton(button, "play", strings.start);
  } else if (snapshot.phase === PHASE_RUNNING) {
    button.disabled = false;
    setControlButton(button, "pause", strings.pause);
  } else if (snapshot.phase === PHASE_PAUSED) {
    button.disabled = false;
    setControlButton(button, "play", strings.resume);
  } else if (snapshot.phase === PHASE_PREPARING) {
    button.disabled = true;
    setControlButton(button, "clock", strings.ready);
  } else if (snapshot.phase === PHASE_SETTLING) {
    button.disabled = true;
    setControlButton(button, "clock", strings.settling);
  } else if (snapshot.phase === PHASE_ENDED) {
    button.disabled = false;
    setControlButton(button, "play", strings.tryAgain);
  }
}

export function renderControllerFailure(page, strings, errorCode) {
  const button = page.querySelector(".game-button");
  button.disabled = true;
  setControlButton(button, "finish", strings.failed);
  const gameZone = page.querySelector("[data-game-zone]");
  gameZone.dataset.phase = "PHASE_ERROR";
  if (errorCode) gameZone.dataset.errorCode = errorCode;
  else errorCode = gameZone.dataset.errorCode;
  gameZone.setAttribute("aria-disabled", "true");
  const panel = document.createElement("section");
  panel.className = "game-error game-runtime-error";
  panel.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.textContent = strings.gameError;
  const hint = document.createElement("p");
  hint.textContent = strings.gameErrorHint;
  panel.append(title, hint);
  if (errorCode) {
    panel.dataset.errorCode = errorCode;
    const code = document.createElement("p");
    code.className = "game-error-code";
    code.textContent = `${strings.errorCode}: ${errorCode}`;
    panel.append(code);
  }
  gameZone.replaceChildren(panel);
}

export function updateGameChromeLanguage(page, strings, unlimited = page.dataset.unlimited === "true") {
  const gameBar = page.querySelector(".game-bar");
  gameBar.setAttribute("aria-label", strings.gameStatus);
  for (const [selector, label] of [[".time-metric", unlimited ? strings.elapsed : strings.time], [".score-metric", strings.score], [".ghost-metric", strings.ghost]]) {
    const metric = page.querySelector(selector);
    metric.title = label;
    metric.querySelector(".visually-hidden").textContent = label;
  }
}
