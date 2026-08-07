import { generateICode } from "./icode.js";
import { loadChallenges, saveChallenges } from "./storage.js";
import { SCORE_MAX } from "./protocol-constants.js";
import { GAME_LIST } from "./game-list.js";

export function createChallengeEntry({ gameID, durIdx, duration, language, now = Date.now(), iCode = generateICode(durIdx) }) {
  const scoreVersion = GAME_LIST.find((game) => game.gameID === gameID)?.scoreVersion;
  return Object.freeze({
    gameID,
    iCode,
    durIdx,
    createdAt: now,
    memo: formatTime(now, language, "long"),
    bestScore: 0,
    ...(scoreVersion === undefined ? {} : { scoreVersion }),
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
  const index = entries.findIndex((item) => item.gameID === gameID && item.iCode === iCode);
  if (index < 0) return false;
  const entry = entries[index];
  const improved = score > entry.bestScore;
  if (!improved && index === 0) return false;
  if (improved) entry.bestScore = score;
  if (index > 0) {
    entries.splice(index, 1);
    entries.unshift(entry);
  }
  saveChallenges(entries);
  return improved;
}

export function recordChallengeBestScore({ gameID, iCode, durIdx, duration, language, score }) {
  if (!Number.isSafeInteger(score) || score < 0 || score > SCORE_MAX) throw new RangeError("score must be a valid result score");
  const entries = loadChallenges();
  const index = entries.findIndex((item) => item.gameID === gameID && item.iCode === iCode);
  let entry;
  if (index < 0) {
    entry = { ...createChallengeEntry({ gameID, iCode, durIdx, duration, language }), bestScore: score };
  } else {
    entry = entries.splice(index, 1)[0];
    entry.bestScore = Math.max(entry.bestScore, score);
  }
  entries.unshift(entry);
  const saved = saveChallenges(entries);
  return saved.find((item) => item.gameID === gameID && item.iCode === iCode)?.bestScore ?? entry.bestScore;
}

export function formatTime(value, language, style) {
  const options = style === "short"
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", options).format(new Date(value));
}
