const STORAGE_KEY = "zuben.2048.unlimitedCheckpoint";
const RECORD_VERSION = 1;

export function load2048Checkpoint(iCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || parsed.version !== RECORD_VERSION || parsed.iCode !== iCode || !parsed.checkpoint) return null;
    return parsed.checkpoint;
  } catch {
    return null;
  }
}

export function save2048Checkpoint(iCode, checkpoint) {
  if (typeof iCode !== "string" || !checkpoint) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: RECORD_VERSION, iCode, checkpoint }));
    return true;
  } catch {
    return false;
  }
}

export function clear2048Checkpoint(iCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (iCode === undefined || !parsed || parsed.iCode === iCode) localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return false;
  }
}
