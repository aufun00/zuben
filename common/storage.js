import { GAME_LIST } from "./game-list.js";
import { parseICode } from "./icode.js";

export const MAX_CHALLENGES = 100;
export const MAX_CHALLENGE_MEMO_LENGTH = 200;

const MAX_DATE_MS = 8_640_000_000_000_000;

const KEYS = {
  nickname: "zuben.nickname",
  mode: "zuben.homepageMode",
  language: "zuben.language",
  challenges: "zuben.challengeList",
  readedVer: "zuben.readedVer",
};

const memoryPreferences = new Map();
let memoryChallenges = [];
let storageAvailable = true;
const storageListeners = new Set();

export function isPersistentStorageAvailable() {
  return storageAvailable;
}

export function subscribeStorageAvailability(listener) {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

export function getPreference(key, fallback) {
  if (storageAvailable) {
    try {
      const value = localStorage.getItem(KEYS[key]);
      if (value !== null) {
        memoryPreferences.set(key, value);
        return value;
      }
    } catch (error) {
      markStorageUnavailable(error);
    }
  }
  return memoryPreferences.has(key) ? memoryPreferences.get(key) : fallback;
}

export function setPreference(key, value) {
  const normalized = String(value);
  memoryPreferences.set(key, normalized);
  if (storageAvailable) {
    try {
      localStorage.setItem(KEYS[key], normalized);
    } catch (error) {
      markStorageUnavailable(error);
    }
  }
  return storageAvailable;
}

export function loadChallenges() {
  if (storageAvailable) {
    let serialized;
    try {
      serialized = localStorage.getItem(KEYS.challenges);
    } catch (error) {
      markStorageUnavailable(error);
      return cloneChallenges(memoryChallenges);
    }
    try {
      memoryChallenges = normalizeChallenges(JSON.parse(serialized ?? "[]"));
    } catch {
      memoryChallenges = [];
    }
  }
  return cloneChallenges(memoryChallenges);
}

export function saveChallenges(entries) {
  const normalized = normalizeChallenges(entries);
  memoryChallenges = cloneChallenges(normalized);
  if (storageAvailable) {
    try {
      localStorage.setItem(KEYS.challenges, JSON.stringify(toPersistedChallenges(normalized)));
    } catch (error) {
      markStorageUnavailable(error);
    }
  }
  return cloneChallenges(normalized);
}

export function normalizeChallenges(value) {
  if (!Array.isArray(value)) return [];

  const normalized = value
    .map(normalizeChallengeEntry)
    .filter((entry) => entry !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
  const keys = new Set();
  const unique = [];
  for (const entry of normalized) {
    const key = `${entry.gameID}:${entry.iCode}`;
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(entry);
    if (unique.length === MAX_CHALLENGES) break;
  }
  return unique;
}

function normalizeChallengeEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.gameID !== "string" || typeof value.iCode !== "string") return null;
  if (typeof value.memo !== "string" || !isValidCreatedAt(value.createdAt)) return null;

  const game = GAME_LIST.find((item) => item.gameID === value.gameID);
  if (!game) return null;
  const parsed = parseICode(value.iCode);
  const duration = parsed.ok ? game.durs[parsed.durIdx] : undefined;
  if (!Number.isInteger(duration) || duration <= 0) return null;

  return {
    gameID: game.gameID,
    iCode: value.iCode,
    durationMark: Math.max(1, Math.round(duration / 10)),
    createdAt: value.createdAt,
    memo: truncateMemo(value.memo.trim()),
  };
}

function isValidCreatedAt(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS;
}

function truncateMemo(value) {
  return Array.from(value).slice(0, MAX_CHALLENGE_MEMO_LENGTH).join("");
}

function cloneChallenges(entries) {
  return entries.map((entry) => ({ ...entry }));
}

function toPersistedChallenges(entries) {
  return entries.map(({ gameID, iCode, createdAt, memo }) => ({ gameID, iCode, createdAt, memo }));
}

function markStorageUnavailable(error) {
  if (!storageAvailable) return;
  storageAvailable = false;
  console.warn("Persistent storage is unavailable; using in-memory storage", error);
  for (const listener of storageListeners) listener(false);
}
