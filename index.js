import { GAME_LIST, findGame } from "./common/game-list.js";
import { renderHomepage } from "./homepage.js";

const mount = document.querySelector("#app");
let appVersion = "?";

async function route() {
  const url = new URL(location.href);
  const gameIdx = url.searchParams.get("g");
  const game = gameIdx !== null ? findGame(gameIdx) : null;

  if (!game) {
    if (url.search) history.replaceState(null, "", url.pathname);
    renderHomepage(mount, { gameList: GAME_LIST, version: appVersion });
    return;
  }

  try {
    const module = await import(`./${game.gameID}/game.js`);
    module.renderGamePage(mount, {
      game,
      gameIdx: Number(gameIdx),
      params: new URLSearchParams(url.search),
      version: appVersion,
    });
  } catch (error) {
    console.error(error);
    history.replaceState(null, "", url.pathname);
    renderHomepage(mount, { gameList: GAME_LIST, version: appVersion });
  }
}

window.addEventListener("popstate", route);
window.addEventListener("zuben:navigate-home", route);

appVersion = await readServiceWorkerVersion();
route();

async function readServiceWorkerVersion() {
  if (!("serviceWorker" in navigator)) return "?";
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    if (registration.active && !registration.waiting && !registration.installing) {
      try { await registration.update(); } catch {}
    }
    const worker = await getVersionWorker(registration);
    return await requestVersion(worker);
  } catch (error) {
    console.error("Could not read Zuben version from Service Worker", error);
    return "?";
  }
}

function getVersionWorker(registration) {
  const worker = registration.waiting ?? registration.installing ?? registration.active;
  if (!worker) return Promise.reject(new Error("Service Worker is unavailable"));
  if (worker.state === "activated") return Promise.resolve(worker);
  return new Promise((resolve, reject) => {
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve(worker);
      else if (worker.state === "redundant") reject(new Error("Service Worker became redundant"));
    });
  });
}

function requestVersion(worker) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => reject(new Error("Service Worker version request timed out")), 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      const version = event.data?.version;
      if (typeof version === "string" && version) resolve(version);
      else reject(new Error("Service Worker returned an invalid version"));
    };
    worker.postMessage({ type: "GET_ZUBEN_VERSION" }, [channel.port2]);
  });
}
