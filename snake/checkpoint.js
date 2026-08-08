const STORAGE_KEY = "zuben.snake.unlimitedCheckpoint";
const RECORD_VERSION = 3;

export function loadSnakeCheckpoint(iCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed?.version === RECORD_VERSION && parsed.iCode === iCode && parsed.checkpoint ? parsed.checkpoint : null;
  } catch { return null; }
}

export function saveSnakeCheckpoint(iCode, checkpoint) {
  if (typeof iCode !== "string" || !checkpoint) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: RECORD_VERSION, iCode, checkpoint }));
    return true;
  } catch { return false; }
}

export function clearSnakeCheckpoint(iCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (iCode === undefined || !parsed || parsed.iCode === iCode) localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return false;
  }
}
