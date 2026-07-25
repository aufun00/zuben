import { generateICode } from "./icode.js";
import { loadChallenges, saveChallenges } from "./storage.js";
import { SCORE_MAX } from "./protocol-constants.js";

export function createChallengeEntry({ gameID, durIdx, duration, language, now = Date.now(), iCode = generateICode(durIdx) }) {
  return Object.freeze({
    gameID,
    iCode,
    durationMark: Math.max(1, Math.round(duration / 10)),
    createdAt: now,
    memo: formatTime(now, language, "long"),
    bestScore: 0,
  });
}

export function saveChallengeOnce(entry) {
  const entries = loadChallenges();
  if (!entries.some((item) => item.gameID === entry.gameID && item.iCode === entry.iCode)) {
    entries.unshift(entry);
    saveChallenges(entries);
  }
  return entry;
}

export function updateChallengeBestScore({ gameID, iCode, score }) {
  if (!Number.isSafeInteger(score) || score < 0 || score > SCORE_MAX) return false;
  const entries = loadChallenges();
  const entry = entries.find((item) => item.gameID === gameID && item.iCode === iCode);
  if (!entry || score <= entry.bestScore) return false;
  entry.bestScore = score;
  saveChallenges(entries);
  return true;
}

export function formatTime(value, language, style) {
  const options = style === "short"
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", options).format(new Date(value));
}
