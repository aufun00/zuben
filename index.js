let reloadingForWorkerUpdate = false;
let deferredFirstController = null;
let publishFirstControllerVersion = (worker) => { deferredFirstController = worker; };
if ("serviceWorker" in navigator) {
  const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadServiceWorkerController) {
      if (reloadingForWorkerUpdate) return;
      reloadingForWorkerUpdate = true;
      location.reload();
      return;
    }
    const worker = navigator.serviceWorker.controller;
    if (worker) publishFirstControllerVersion(worker);
  });
}

const [gameListModule, homepageModule, versionStateModule, modalModule, timeoutModule] = await Promise.all([
  import("./common/game-list.js"),
  import("./homepage.js"),
  import("./common/version-state.js"),
  import("./common/modal.js"),
  import("./common/timeout.js"),
]);
const { GAME_LIST, findGame } = gameListModule;
const { disposeHomepage, renderHomepage } = homepageModule;
const { getAppVersion, setAppVersion } = versionStateModule;
const { closeActiveModal } = modalModule;
const { withTimeout } = timeoutModule;
publishFirstControllerVersion = (worker) => {
  void requestVersion(worker).then(setAppVersion).catch((error) => {
    console.error("Could not read Zuben version from the first Controller", error);
  });
};
if (deferredFirstController) publishFirstControllerVersion(deferredFirstController);

const mount = document.querySelector("#app");
let routeGeneration = 0;

async function route() {
  const generation = ++routeGeneration;
  closeActiveModal({ restoreFocus: false });
  disposeHomepage(mount);
  const url = new URL(location.href);
  const gameIdx = url.searchParams.get("g");
  const game = gameIdx !== null ? findGame(gameIdx) : null;

  if (!game) {
    if (url.search) history.replaceState(null, "", url.pathname);
    renderHomepage(mount, { gameList: GAME_LIST, version: getAppVersion() });
    return;
  }

  try {
    const module = await import(`./${game.gameID}/game.js`);
    if (generation !== routeGeneration) return;
    module.renderGamePage(mount, {
      game,
      gameIdx: Number(gameIdx),
      params: new URLSearchParams(url.search),
      version: getAppVersion(),
    });
  } catch (error) {
    if (generation !== routeGeneration) return;
    console.error(error);
    history.replaceState(null, "", url.pathname);
    renderHomepage(mount, { gameList: GAME_LIST, version: getAppVersion() });
  }
}

window.addEventListener("popstate", route);
window.addEventListener("zuben:navigate-home", route);

void route();
void monitorServiceWorkerVersion();

async function monitorServiceWorkerVersion() {
  if (!("serviceWorker" in navigator)) return;
  const eventualVersion = readVersionFromWorker();
  let settled = false;
  void eventualVersion.then(
    (version) => { settled = true; setAppVersion(version); },
    (error) => { settled = true; console.error("Could not read Zuben version from Service Worker", error); },
  );
  try {
    await withTimeout(eventualVersion, 5000, "Service Worker version flow timed out");
  } catch (error) {
    if (!settled) console.error("Zuben version is not available yet", error);
    setAppVersion("?");
  }
}

async function readVersionFromWorker() {
  const registration = await navigator.serviceWorker.register("./sw.js");
  if (registration.active && !registration.waiting && !registration.installing) {
    void registration.update().catch(() => {});
  }
  const worker = await getVersionWorker(registration);
  return requestVersion(worker);
}

function getVersionWorker(registration) {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
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
