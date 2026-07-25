import { GAME_LIST, findGame } from "./common/game-list.js";
import { renderHomepage } from "./homepage.js";

const APP_VERSION = "0.0.3";
const mount = document.querySelector("#app");

async function route() {
  const url = new URL(location.href);
  const gameIdx = url.searchParams.get("g");
  const game = gameIdx !== null ? findGame(gameIdx) : null;

  if (!game) {
    if (url.search) history.replaceState(null, "", url.pathname);
    renderHomepage(mount, { gameList: GAME_LIST, version: APP_VERSION });
    return;
  }

  try {
    const module = await import(`./${game.gameID}/game.js`);
    module.renderGamePage(mount, {
      game,
      params: new URLSearchParams(url.search),
      version: APP_VERSION,
    });
  } catch (error) {
    console.error(error);
    history.replaceState(null, "", url.pathname);
    renderHomepage(mount, { gameList: GAME_LIST, version: APP_VERSION });
  }
}

window.addEventListener("popstate", route);
window.addEventListener("fp:navigate-home", route);

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

route();
