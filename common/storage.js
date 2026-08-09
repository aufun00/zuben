import { GAME_LIST } from "./game-list.js";
import { parseICode } from "./icode.js";
import { SCORE_MAX } from "./protocol-constants.js";

export const CHALLENGE_CFG = Object.freeze({
  MaxEntries: 30,
  MaxMemoLength: 200,
});
export const MAX_CHALLENGES = CHALLENGE_CFG.MaxEntries;
export const MAX_CHALLENGE_MEMO_LENGTH = CHALLENGE_CFG.MaxMemoLength;

const MAX_DATE_MS = 8_640_000_000_000_000;

const KEYS = {
  nickname: "zuben.nickname",
  language: "zuben.language",
  challenges: "zuben.challengeList",
  readedVer: "zuben.readedVer",
  gameBarTour: "zuben.gameBarTour",
  music: "zuben.music",
  soundEffects: "zuben.soundEffects",
  metrics: "zuben.metrics",
  linefitUIStyle: "zuben.linefitUIStyle",
  linefitUIStyleChosen: "zuben.linefitUIStyleChosen",
};

const memoryPreferences = new Map();
let memoryChallenges = [];
let storageAvailable = true;
const storageListeners = new Set();
const preferenceListeners = new Map();

export function isPersistentStorageAvailable() {
  return storageAvailable;
}

export function subscribeStorageAvailability(listener) {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

export function getPreference(key, fallback) {
  if (storageAvailable && typeof globalThis.localStorage !== "undefined") {
    try {
      const value = globalThis.localStorage.getItem(KEYS[key]);
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
  if (storageAvailable && typeof globalThis.localStorage !== "undefined") {
    try {
      globalThis.localStorage.setItem(KEYS[key], normalized);
    } catch (error) {
      markStorageUnavailable(error);
    }
  }
  for (const listener of preferenceListeners.get(key) ?? []) listener(normalized);
  return storageAvailable;
}

export function subscribePreference(key, listener) {
  if (typeof listener !== "function") throw new TypeError("listener must be a function");
  let listeners = preferenceListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    preferenceListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) preferenceListeners.delete(key);
  };
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
    let parsedSuccessfully = true;
    try {
      memoryChallenges = normalizeChallenges(JSON.parse(serialized ?? "[]"));
    } catch {
      memoryChallenges = [];
      parsedSuccessfully = false;
    }
    const migrated = JSON.stringify(toPersistedChallenges(memoryChallenges));
    if (parsedSuccessfully && serialized !== null && serialized !== migrated) {
      try {
        localStorage.setItem(KEYS.challenges, migrated);
      } catch (error) {
        markStorageUnavailable(error);
      }
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
    .filter((entry) => entry !== null);
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
    durIdx: parsed.durIdx,
    createdAt: value.createdAt,
    memo: truncateMemo(value.memo.trim()),
    bestScore: game.scoreVersion === undefined || value.scoreVersion === game.scoreVersion ? normalizeBestScore(value.bestScore) : 0,
    ...(game.scoreVersion === undefined ? {} : { scoreVersion: game.scoreVersion }),
  };
}

function isValidCreatedAt(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE_MS;
}

function truncateMemo(value) {
  return Array.from(value).slice(0, MAX_CHALLENGE_MEMO_LENGTH).join("");
}

function normalizeBestScore(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= SCORE_MAX ? value : 0;
}

function cloneChallenges(entries) {
  return entries.map((entry) => ({ ...entry }));
}

function toPersistedChallenges(entries) {
  return entries.map(({ gameID, iCode, createdAt, memo, bestScore, scoreVersion }) => ({ gameID, iCode, createdAt, memo, bestScore, ...(scoreVersion === undefined ? {} : { scoreVersion }) }));
}

function markStorageUnavailable(error) {
  if (!storageAvailable) return;
  storageAvailable = false;
  console.warn("Persistent storage is unavailable; using in-memory storage", error);
  for (const listener of storageListeners) listener(false);
}
