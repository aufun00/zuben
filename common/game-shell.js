import { renderHeader } from "./header.js";
import { iconMarkup } from "./icons.js";
import { parseICode } from "./icode.js";

export function renderGameShell(mount, { game, params, version, gameStrings }) {
  mount.replaceChildren();
  const rerender = () => renderGameShell(mount, { game, params, version, gameStrings });
  const { language, strings } = renderHeader(mount, {
    version,
    onModeChange: rerender,
    onLanguageChange: rerender,
  });
  const localized = gameStrings[language] ?? gameStrings.en;
  const parsed = parseICode(params.get("c"));

  if (!parsed.ok || !game.durs[parsed.durIdx]) {
    const error = document.createElement("main");
    error.className = "game-error";
    error.innerHTML = `<h1>${strings.invalidChallenge}</h1><p>${strings.invalidChallengeHint}</p>`;
    mount.append(error);
    return;
  }

  const duration = game.durs[parsed.durIdx];
  const page = document.createElement("main");
  page.className = "game-page";
  page.innerHTML = `
    <section class="game-status" aria-label="Game status">
      <div><span>${strings.time}</span><strong data-time>${duration}.000</strong></div>
      <div><span>${strings.score}</span><strong data-score>0</strong></div>
      <button class="game-control" type="button">${strings.start}</button>
      <div><span>${strings.ghost}</span><strong>${readGhostScore(params)}</strong></div>
    </section>
    <section class="game-stage">
      ${iconMarkup(game.gameID, "game-stage-icon")}
      <h1>${localized.name}</h1>
      <p>${strings.gamePlaceholder}</p>
      <div class="rules-card" data-rules>
        <span>${strings.rules}</span>
        <p>${localized.rules}</p>
      </div>
      <output class="countdown" data-countdown hidden></output>
    </section>
  `;
  mount.append(page);
  connectClock(page, duration, strings);
}

function readGhostScore(params) {
  const raw = params.get("r");
  return /^\d{1,4}$/.test(raw ?? "") ? Number(raw) : 0;
}

function connectClock(page, durationSeconds, strings) {
  const button = page.querySelector(".game-control");
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
    time.textContent = (remaining / 1000).toFixed(3);
    if (remaining === 0) {
      phase = "finished";
      button.disabled = true;
      button.textContent = "Finish";
      return;
    }
    frame = requestAnimationFrame(paint);
  };

  const prepare = () => {
    phase = "preparing";
    rules.hidden = true;
    button.disabled = true;
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
      button.textContent = strings.pause;
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
      button.textContent = strings.resume;
    } else if (phase === "paused") {
      prepare();
    }
  });
}
