const KEYS = {
  nickname: "zuben.nickname",
  mode: "zuben.homepageMode",
  language: "zuben.language",
  challenges: "zuben.challengeList",
  readedVer: "zuben.readedVer",
};

export function getPreference(key, fallback) {
  return localStorage.getItem(KEYS[key]) ?? fallback;
}

export function setPreference(key, value) {
  localStorage.setItem(KEYS[key], String(value));
}

export function loadChallenges() {
  try {
    const value = JSON.parse(localStorage.getItem(KEYS.challenges) ?? "[]");
    return Array.isArray(value) ? value.filter(isChallengeEntry) : [];
  } catch {
    return [];
  }
}

export function saveChallenges(entries) {
  localStorage.setItem(KEYS.challenges, JSON.stringify(entries));
}

function isChallengeEntry(value) {
  return value &&
    typeof value.gameID === "string" &&
    typeof value.iCode === "string" &&
    Number.isInteger(value.durationMark) &&
    Number.isFinite(value.createdAt) &&
    typeof value.memo === "string";
}
