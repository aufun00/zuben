import { createChallengeEntry, saveChallengeOnce } from "./challenges.js";
import { getPreference } from "./storage.js";
import { encodeResultCode } from "./result-code.js";
import { buildChallengeURL, copyText, inviteShareText, scoreShareText, shareContent } from "./share.js";
import { createQrSvg } from "./qr.js";

export function createGameResultView({ overlay, gameIdx, game, parsed, result, ghostScore, language, strings, localized }) {
  const frozenResult = Object.freeze({ score: result.score, reason: result.reason, endedAtMs: result.endedAtMs });
  let activeLanguage = language;
  let activeStrings = strings;
  let activeLocalized = localized;
  let resultChallenge = null;
  let sharingChallenge = false;

  overlay.classList.add("game-result-overlay");
  overlay.innerHTML = `
    <article class="result-card">
      <div class="result-outcome-icon" data-result-icon aria-hidden="true"></div>
      <h1 data-result-outcome></h1>
      <p class="result-reason" data-result-reason></p>
      <strong class="result-score" data-result-score></strong>
      <button class="result-action primary" type="button" data-share-score></button>
      <div class="result-secondary-actions">
        <button class="result-action" type="button" data-new-challenge></button>
        <button class="result-action" type="button" data-other-games></button>
      </div>
    </article>
  `;

  const scoreButton = overlay.querySelector("[data-share-score]");
  const challengeButton = overlay.querySelector("[data-new-challenge]");
  scoreButton.addEventListener("click", openScoreShareSheet);
  challengeButton.addEventListener("click", shareNewChallenge);
  overlay.querySelector("[data-other-games]").addEventListener("click", () => {
    history.pushState(null, "", location.pathname);
    dispatchEvent(new Event("zuben:navigate-home"));
  });
  paint();

  return Object.freeze({
    result: frozenResult,
    setLanguage(next) {
      activeLanguage = next.language;
      activeStrings = next.strings;
      activeLocalized = next.localized;
      paint();
    },
  });

  function paint() {
    const outcome = frozenResult.score > ghostScore ? "win" : frozenResult.score < ghostScore ? "lose" : "tie";
    overlay.dataset.outcome = outcome;
    overlay.querySelector("[data-result-icon]").textContent = outcome === "win" ? "◆" : outcome === "lose" ? "◇" : "═";
    overlay.querySelector("[data-result-outcome]").textContent = activeStrings[`result${capitalize(outcome)}`];
    overlay.querySelector("[data-result-reason]").textContent = activeLocalized.resultReasons?.[frozenResult.reason] ?? activeLocalized.timeUp ?? frozenResult.reason;
    overlay.querySelector("[data-result-score]").textContent = String(frozenResult.score);
    scoreButton.textContent = activeStrings.shareMyScore;
    challengeButton.textContent = activeStrings.startNewChallenge;
    overlay.querySelector("[data-other-games]").textContent = activeStrings.otherGames;
  }

  function openScoreShareSheet() {
    const resultCode = frozenResult.score === 0 ? undefined : encodeResultCode(frozenResult.score, game.gameID, parsed.code);
    const url = buildChallengeURL({ gameIdx, iCode: parsed.code, resultCode });
    const nickname = currentNickname();
    const text = scoreShareText(nickname, frozenResult.score, activeLocalized.name, parsed.code, activeStrings);
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop result-share-backdrop";
    backdrop.innerHTML = `
      <section class="modal-card result-share-sheet">
        <h2></h2>
        <div class="result-qr"></div>
        <p class="result-share-copy"></p>
        <div class="modal-actions">
          <button class="action-button cancel" type="button"></button>
          <button class="action-button" type="button" data-copy></button>
          <button class="action-button primary" type="button" data-native-share></button>
        </div>
      </section>
    `;
    backdrop.querySelector("h2").textContent = activeStrings.shareMyScore;
    backdrop.querySelector(".result-share-copy").textContent = text;
    backdrop.querySelector(".result-qr").append(createQrSvg(url, activeStrings.resultQr));
    const closeButton = backdrop.querySelector(".cancel");
    closeButton.textContent = activeStrings.cancel;
    backdrop.querySelector("[data-copy]").textContent = activeStrings.copy;
    backdrop.querySelector("[data-native-share]").textContent = activeStrings.share;
    closeButton.addEventListener("click", () => backdrop.remove());
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
    backdrop.querySelector("[data-copy]").addEventListener("click", () => copyText(`${text}\n${url}`, activeStrings));
    backdrop.querySelector("[data-native-share]").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      await shareContent({ text, url, strings: activeStrings });
      event.currentTarget.disabled = false;
    });
    document.body.append(backdrop);
  }

  async function shareNewChallenge() {
    if (sharingChallenge) return;
    sharingChallenge = true;
    challengeButton.disabled = true;
    try {
      if (!resultChallenge) {
        resultChallenge = createChallengeEntry({
          gameID: game.gameID,
          durIdx: parsed.durIdx,
          duration: game.durs[parsed.durIdx],
          language: activeLanguage,
        });
        saveChallengeOnce(resultChallenge);
      }
      const url = buildChallengeURL({ gameIdx, iCode: resultChallenge.iCode });
      const text = inviteShareText(currentNickname(), activeLocalized.name, activeStrings);
      await shareContent({ text, url, strings: activeStrings });
    } finally {
      sharingChallenge = false;
      challengeButton.disabled = false;
    }
  }

  function currentNickname() {
    return getPreference("nickname", activeStrings.nickname);
  }
}

function capitalize(value) { return value[0].toUpperCase() + value.slice(1); }
