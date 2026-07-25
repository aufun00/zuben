let appVersion = "?";
const listeners = new Set();

export function getAppVersion() {
  return appVersion;
}

export function setAppVersion(version) {
  if (typeof version !== "string" || !version || version === appVersion) return;
  appVersion = version;
  for (const listener of listeners) listener(appVersion);
}

export function subscribeAppVersion(listener) {
  listeners.add(listener);
  listener(appVersion);
  return () => listeners.delete(listener);
}
