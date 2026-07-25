import { generateICode } from "./icode.js";
import { loadChallenges, saveChallenges } from "./storage.js";

export function createChallengeEntry({ gameID, durIdx, duration, language, now = Date.now(), iCode = generateICode(durIdx) }) {
  return Object.freeze({
    gameID,
    iCode,
    durationMark: Math.max(1, Math.round(duration / 10)),
    createdAt: now,
    memo: formatTime(now, language, "long"),
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

export function formatTime(value, language, style) {
  const options = style === "short"
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", options).format(new Date(value));
}
