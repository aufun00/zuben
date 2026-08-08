const STORAGE_KEY = "zuben.linefit.unlimitedCheckpoint";
const RECORD_VERSION = 1;

export function loadLineFitCheckpoint(iCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || parsed.version !== RECORD_VERSION || parsed.iCode !== iCode || !parsed.checkpoint) return null;
    return parsed.checkpoint;
  } catch {
    return null;
  }
}

export function saveLineFitCheckpoint(iCode, checkpoint) {
  if (typeof iCode !== "string" || !checkpoint) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: RECORD_VERSION, iCode, checkpoint }));
    return true;
  } catch {
    return false;
  }
}

export function clearLineFitCheckpoint(iCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (iCode === undefined || !parsed || parsed.iCode === iCode) localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return false;
  }
}
