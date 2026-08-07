import { encodeResultCode } from "./result-code.js";
import { GAME_LIST } from "./game-list.js";

export function buildChallengeSharePayload({
  nickname, score, gameIdx, gameID, gameDisplayName, iCode, strings, baseHref = location.href,
}) {
  const base = new URL(baseHref);
  const url = new URL(base.pathname, base.origin);
  url.searchParams.set("g", String(gameIdx));
  url.searchParams.set("c", iCode);
  url.searchParams.set("r", encodeResultCode(score, gameID, iCode));
  const scoreVersion = GAME_LIST.find((game) => game.gameID === gameID)?.scoreVersion;
  if (scoreVersion !== undefined) url.searchParams.set("sv", scoreVersion);
  const scoreText = score === 0
    ? ""
    : `${strings.challengeShareScorePrefix}${score}${strings.challengeShareScoreSuffix}`;
  const text = `${nickname}${strings.challengeShareAfterNickname}${scoreText}${strings.challengeShareBeforeGame}${gameDisplayName} # ${iCode.slice(-4)}`;
  return Object.freeze({ text, url: url.href });
}

export async function shareContent({ text, url, strings, title = "Zuben", navigatorObject = navigator }) {
  if (typeof navigatorObject.share === "function") {
    try {
      await navigatorObject.share({ title, text, url });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  await copyText(`${text}\n${url}`, strings, navigatorObject);
  return "copied";
}

export async function copyText(text, strings, navigatorObject = navigator) {
  try {
    await navigatorObject.clipboard.writeText(text);
    showToast(strings.copied);
  } catch {
    prompt(strings.copy, text);
  }
}

function showToast(text) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 1400);
}
