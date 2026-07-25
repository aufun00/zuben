const VERSION = "0.0.12";
const CACHE_NAME = `zuben-${VERSION}`;
const NETWORK_TIMEOUT_MS = 3000;
const CORE = [
  "./", "./index.html", "./index.js", "./index.css", "./homepage.js", "./homepage.css",
  "./lang.js", "./version.json", "./icon.svg", "./manifest.webmanifest",
  "./common/game-list.js", "./common/storage.js", "./common/version-state.js", "./common/protocol-constants.js", "./common/icode.js", "./common/rng.js", "./common/qr.js", "./common/icons.js",
  "./common/header.js", "./common/modal.js", "./common/timeout.js", "./common/challenges.js", "./common/share.js", "./common/result-code.js", "./common/game-result.js",
  "./common/game-flow-config.js", "./common/game-controller.js", "./common/gesture-input.js", "./common/game-shell.js", "./common/game-shell.css",
  "./match3/config.js", "./match3/engine.js", "./match3/game.js", "./match3/game.css", "./match3/lang.js",
  "./stacker/config.js", "./stacker/engine.js", "./stacker/game.js", "./stacker/game.css", "./stacker/lang.js", "./stacker/mesh.js",
  "./runner/game.js", "./runner/lang.js",
];
const CORE_URLS = new Set(CORE.map((path) => new URL(path, self.location.href).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names
        .filter((name) => name !== CACHE_NAME && (name.startsWith("zuben-") || name.startsWith("fpcodex-")))
        .map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "GET_ZUBEN_VERSION") event.ports[0]?.postMessage({ version: VERSION });
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cacheKey = request.mode === "navigate" ? "./index.html" : CORE_URLS.has(new URL(request.url).href) ? request : null;
  const cache = cacheKey === null ? null : await caches.open(CACHE_NAME);
  const cached = cache === null ? null : await cache.match(cacheKey);
  const controller = cached ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS) : null;
  try {
    const response = await fetch(request, controller ? { signal: controller.signal } : undefined);
    if (!response.ok && cached) return cached;
    if (response.ok && cache !== null) {
      await cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    if (cached) return cached;
    return Response.error();
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}
