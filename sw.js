const VERSION = "0.0.11";
const CACHE_NAME = `zuben-${VERSION}`;
const CORE = [
  "./", "./index.html", "./index.js", "./index.css", "./homepage.js", "./homepage.css",
  "./lang.js", "./version.json", "./icon.svg", "./manifest.webmanifest",
  "./common/game-list.js", "./common/storage.js", "./common/icode.js", "./common/rng.js", "./common/qr.js", "./common/icons.js",
  "./common/header.js", "./common/challenges.js", "./common/share.js", "./common/result-code.js", "./common/game-result.js",
  "./common/game-flow-config.js", "./common/game-controller.js", "./common/game-shell.js", "./common/game-shell.css",
  "./match3/config.js", "./match3/engine.js", "./match3/game.js", "./match3/game.css", "./match3/lang.js",
  "./stacker/config.js", "./stacker/engine.js", "./stacker/game.js", "./stacker/game.css", "./stacker/lang.js", "./stacker/mesh.js",
  "./runner/game.js", "./runner/lang.js",
];

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
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const key = request.mode === "navigate" ? "./index.html" : request;
      await cache.put(key, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("./index.html");
    return Response.error();
  }
}
