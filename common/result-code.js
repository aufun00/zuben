import { BASE64URL_ALPHABET, SCORE_MAX } from "./protocol-constants.js";

export function encodeResultCode(score, gameID, iCode) {
  const normalized = normalizeScore(score);
  const value = normalized ^ resultMask(gameID, iCode);
  return [18, 12, 6, 0].map((shift) => BASE64URL_ALPHABET[(value >>> shift) & 0x3f]).join("");
}

export function parseResultCode(code, gameID, iCode) {
  if (!/^[A-Za-z0-9_-]{4}$/.test(code ?? "")) return { ok: false, score: 0 };
  let value = 0;
  for (const character of code) value = (value << 6) | BASE64URL_ALPHABET.indexOf(character);
  const score = (value ^ resultMask(gameID, iCode)) >>> 0;
  return score <= SCORE_MAX ? { ok: true, score } : { ok: false, score: 0 };
}

export function readResultScore(params, gameID, iCode) {
  const values = params.getAll("r");
  if (values.length !== 1) return 0;
  const parsed = parseResultCode(values[0], gameID, iCode);
  return parsed.ok ? parsed.score : 0;
}

function resultMask(gameID, iCode) {
  let hash = 0x811c9dc5;
  for (const character of `zuben:r:${gameID}:${iCode}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash & 0xffffff;
}

function normalizeScore(score) {
  const value = Number(score);
  if (!Number.isInteger(value) || value < 0 || value > SCORE_MAX) throw new RangeError("Score must be an integer from 0 to 9,999,999");
  return value;
}
