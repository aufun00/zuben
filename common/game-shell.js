import { renderHeader } from "./header.js";
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
  const ghostScore = readResultScore(params, game.gameID, parsed.code);
  const page = document.createElement("main");
  page.className = "game-page game-page-fixed-ui";
  page.innerHTML = `
    <section class="game-bar" aria-label="${strings.gameStatus}">
      <div class="status-metric time-metric" title="${strings.time}">
        <span class="visually-hidden">${strings.time}</span><strong data-time>${formatRemaining(duration * 1000)}</strong>
      </div>
      <button class="game-button" type="button" data-control-state="play" aria-label="${strings.start}" title="${strings.start}">${strings.start}</button>
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
  updateTugBar(page, 0, ghostScore, strings, 0, duration * 1000);
  tourBinding = createGameBarTour(page, strings);
  if (setupGame) {
    const performanceMeter = createPerformanceMeter(headerBinding.performanceMeterHost, performanceMeterCfg);
    const binding = setupGame({
      page,
      gameZone: page.querySelector("[data-game-zone]"),
      parsed,
      game,
      gameIdx,
      durationMs: duration * 1000,
      ghostScore,
      strings,
      localized,
      performanceMeter,
    });
    if (typeof binding === "function") cleanup = () => { binding(); performanceMeter.destroy(); };
    else if (binding) {
      cleanup = () => { binding.cleanup?.(); performanceMeter.destroy(); };
      languageBinding = (nextLanguage) => {
        const nextStrings = LANG[nextLanguage] ?? LANG.en;
        const nextLocalized = gameStrings[nextLanguage] ?? gameStrings.en;
        updateGameChromeLanguage(page, nextStrings);
        tourBinding?.setLanguage(nextStrings);
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

export function setControlButton(button, state, label) {
  button.textContent = label;
  button.dataset.controlState = state;
  button.setAttribute("aria-label", label);
  button.title = label;
}

export function formatRemaining(milliseconds) {
  const tenths = milliseconds <= 0 ? 0 : Math.ceil(milliseconds / 100);
  return `${(tenths / 10).toFixed(1)}s`;
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
    button.disabled = true;
    setControlButton(button, "finish", strings.finished);
  }
}

export function renderControllerFailure(page, strings) {
  const button = page.querySelector(".game-button");
  button.disabled = true;
  setControlButton(button, "finish", strings.failed);
  const gameZone = page.querySelector("[data-game-zone]");
  gameZone.dataset.phase = "PHASE_ERROR";
  gameZone.setAttribute("aria-disabled", "true");
  const panel = document.createElement("section");
  panel.className = "game-error game-runtime-error";
  panel.setAttribute("role", "alert");
  const title = document.createElement("h1");
  title.textContent = strings.gameError;
  const hint = document.createElement("p");
  hint.textContent = strings.gameErrorHint;
  panel.append(title, hint);
  gameZone.replaceChildren(panel);
}

export function updateGameChromeLanguage(page, strings) {
  const gameBar = page.querySelector(".game-bar");
  gameBar.setAttribute("aria-label", strings.gameStatus);
  for (const [selector, label] of [[".time-metric", strings.time], [".score-metric", strings.score], [".ghost-metric", strings.ghost]]) {
    const metric = page.querySelector(selector);
    metric.title = label;
    metric.querySelector(".visually-hidden").textContent = label;
  }
}
