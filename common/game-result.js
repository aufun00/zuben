import { createChallengeEntry, recordChallengeBestScore, saveChallengeOnce } from "./challenges.js";
import { getPreference, loadChallenges, saveChallenges } from "./storage.js";
import { openChallengeShareDialog } from "./share-dialog.js";
import { emitEventSignal } from "./event-signal.js";
import { PHASE_ENDED } from "./game-controller.js";

export function updateGameResultView({ phase, resultView, input, ...viewOptions }, createView = createGameResultView) {
  if (phase !== PHASE_ENDED || resultView) return { input, resultView };
  input?.destroy();
  input = null;
  resultView = createView(viewOptions);
  return { input, resultView };
}

export function createGameResultView({ overlay, gameIdx, game, parsed, result, ghostScore, language, strings, localized, replayHref = location.href }) {
  const frozenResult = Object.freeze({ score: result.score, reason: result.reason });
  const bestScore = recordChallengeBestScore({
    gameID: game.gameID,
    iCode: parsed.code,
    durIdx: parsed.durIdx,
    duration: game.durs[parsed.durIdx],
    language,
    score: frozenResult.score,
  });
  let activeLanguage = language;
  let activeStrings = strings;
  let activeLocalized = localized;
  let resultChallenge = null;

  overlay.classList.add("game-result-overlay");
  overlay.innerHTML = `
    <article class="result-card">
      <div class="result-outcome-icon" data-result-icon aria-hidden="true"></div>
      <h1 data-result-outcome></h1>
      <p class="result-reason" data-result-reason></p>
      <strong class="result-score" data-result-score></strong>
      <button class="result-action primary" type="button" data-share-score><span class="crystal-button-label"></span></button>
      <div class="result-secondary-actions">
        <button class="result-action" type="button" data-new-challenge><span class="crystal-button-label"></span></button>
        <button class="result-action" type="button" data-other-games><span class="crystal-button-label"></span></button>
      </div>
    </article>
  `;

  const scoreButton = overlay.querySelector("[data-share-score]");
  const challengeButton = overlay.querySelector("[data-new-challenge]");
  scoreButton.addEventListener("click", openScoreShareDialog);
  challengeButton.addEventListener("click", openNewChallengeDialog);
  overlay.querySelector("[data-other-games]").addEventListener("click", () => {
    history.pushState({ zubenHomeTab: "games" }, "", location.pathname);
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
    scoreButton.querySelector(".crystal-button-label").textContent = activeStrings.shareMyScore;
    challengeButton.querySelector(".crystal-button-label").textContent = activeStrings.startNewChallenge;
    overlay.querySelector("[data-other-games] .crystal-button-label").textContent = activeStrings.otherGames;
  }

  function openScoreShareDialog() {
    openChallengeShareDialog({
      challenge: { gameID: game.gameID, iCode: parsed.code, score: bestScore },
      gameIdx,
      gameDisplayName: activeLocalized.name,
      nickname: currentNickname(),
      language: activeLanguage,
      strings: activeStrings,
      returnFocus: scoreButton,
      playHref: replayHref,
      onShareOutcome(outcome) {
        if (outcome !== "cancelled") {
          emitEventSignal({ gameID: game.gameID, timeS: game.durs[parsed.durIdx], event: "shareScore" });
        }
      },
    });
  }

  function openNewChallengeDialog() {
    if (!resultChallenge) {
      resultChallenge = createChallengeEntry({
        gameID: game.gameID,
        durIdx: parsed.durIdx,
        duration: game.durs[parsed.durIdx],
        language: activeLanguage,
      });
      saveChallengeOnce(resultChallenge);
    }
    openChallengeShareDialog({
      challenge: { ...resultChallenge, score: resultChallenge.bestScore },
      gameIdx,
      gameDisplayName: activeLocalized.name,
      nickname: currentNickname(),
      language: activeLanguage,
      strings: activeStrings,
      returnFocus: challengeButton,
      onMemoChange(value) {
        const entries = loadChallenges();
        const entry = entries.find((item) => item.gameID === resultChallenge.gameID && item.iCode === resultChallenge.iCode);
        if (!entry) return;
        entry.memo = value;
        const saved = saveChallenges(entries);
        const persisted = saved.find((item) => item.gameID === resultChallenge.gameID && item.iCode === resultChallenge.iCode);
        if (!persisted) return;
        resultChallenge = Object.freeze({ ...resultChallenge, memo: persisted.memo });
        return persisted.memo;
      },
    });
  }

  function currentNickname() {
    return getPreference("nickname", activeStrings.nickname);
  }
}

function capitalize(value) { return value[0].toUpperCase() + value.slice(1); }
