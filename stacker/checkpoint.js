const STORAGE_KEY = "zuben.stacker.unlimitedCheckpoint";
const RECORD_VERSION = 1;

export function loadStackerCheckpoint(iCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || parsed.version !== RECORD_VERSION || parsed.iCode !== iCode || !parsed.checkpoint) return null;
    return parsed.checkpoint;
  } catch {
    return null;
  }
}

export function saveStackerCheckpoint(iCode, checkpoint) {
  if (typeof iCode !== "string" || !checkpoint) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: RECORD_VERSION, iCode, checkpoint }));
    return true;
  } catch {
    return false;
  }
}

export function clearStackerCheckpoint(iCode) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (iCode === undefined || !parsed || parsed.iCode === iCode) localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return false;
  }
}
