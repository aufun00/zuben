const DATABASE_DELETE_TIMEOUT_MS = 1_000;
const FALLBACK_NAVIGATION_DELAY_MS = 120;

export async function clearLocalSiteData(scope = globalThis) {
  const failures = [];
  const setTimer = typeof scope.setTimeout === "function" ? scope.setTimeout.bind(scope) : setTimeout;
  const clearTimer = typeof scope.clearTimeout === "function" ? scope.clearTimeout.bind(scope) : clearTimeout;
  attemptSync("localStorage", () => scope.localStorage?.clear(), failures);
  attemptSync("sessionStorage", () => scope.sessionStorage?.clear(), failures);
  attemptSync("cookies", () => clearCookies(scope.document), failures);

  await Promise.all([
    attemptAsync("Cache Storage", () => clearCaches(scope.caches), failures),
    attemptAsync("IndexedDB", () => clearIndexedDB(scope.indexedDB, setTimer, clearTimer), failures),
    attemptAsync("OPFS", () => clearOriginPrivateFileSystem(scope.navigator), failures),
    attemptAsync("Service Worker", () => unregisterServiceWorkers(scope.navigator), failures),
  ]);
  return Object.freeze({ complete: failures.length === 0, failures: Object.freeze([...failures]) });
}

export async function clearLocalSiteDataAndExit(scope = globalThis) {
  const result = await clearLocalSiteData(scope);
  attemptSync("window.close", () => scope.close?.(), []);
  const schedule = typeof scope.setTimeout === "function" ? scope.setTimeout.bind(scope) : setTimeout;
  schedule(() => {
    try { scope.location?.replace("about:blank"); } catch {}
  }, FALLBACK_NAVIGATION_DELAY_MS);
  return result;
}

function clearCookies(documentObject) {
  if (!documentObject?.cookie) return;
  for (const item of documentObject.cookie.split(";")) {
    const name = item.split("=", 1)[0]?.trim();
    if (!name) continue;
    documentObject.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
  }
}

async function clearCaches(cacheStorage) {
  if (!cacheStorage?.keys || !cacheStorage?.delete) return;
  const names = await cacheStorage.keys();
  const deleted = await Promise.all(names.map((name) => cacheStorage.delete(name)));
  if (deleted.some((value) => value !== true)) throw new Error("One or more Cache Storage entries could not be deleted");
}

async function unregisterServiceWorkers(navigatorObject) {
  const serviceWorker = navigatorObject?.serviceWorker;
  if (!serviceWorker?.getRegistrations) return;
  const registrations = await serviceWorker.getRegistrations();
  const unregistered = await Promise.all(registrations.map((registration) => registration.unregister()));
  if (unregistered.some((value) => value !== true)) throw new Error("One or more Service Workers could not be unregistered");
}

async function clearIndexedDB(indexedDB, setTimer = setTimeout, clearTimer = clearTimeout) {
  if (!indexedDB?.databases || !indexedDB?.deleteDatabase) return;
  const databases = await indexedDB.databases();
  await Promise.all(databases.filter((database) => database.name).map((database) => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(database.name);
    const timer = setTimer(() => reject(new Error(`Timed out deleting IndexedDB ${database.name}`)), DATABASE_DELETE_TIMEOUT_MS);
    const settle = (operation, value) => {
      clearTimer(timer);
      operation(value);
    };
    request.onsuccess = () => settle(resolve);
    request.onerror = () => settle(reject, request.error ?? new Error(`Could not delete IndexedDB ${database.name}`));
    request.onblocked = () => settle(reject, new Error(`IndexedDB ${database.name} is blocked`));
  })));
}

async function clearOriginPrivateFileSystem(navigatorObject) {
  if (!navigatorObject?.storage?.getDirectory) return;
  const root = await navigatorObject.storage.getDirectory();
  for await (const [name] of root.entries()) await root.removeEntry(name, { recursive: true });
}

function attemptSync(label, operation, failures) {
  try {
    operation();
  } catch (error) {
    failures.push(Object.freeze({ label, error }));
  }
}

async function attemptAsync(label, operation, failures) {
  try {
    await operation();
  } catch (error) {
    failures.push(Object.freeze({ label, error }));
  }
}
