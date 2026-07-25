import { renderGameShell } from "../common/game-shell.js";
import { GAME_LANG } from "./lang.js";

export function renderGamePage(mount, context) {
  renderGameShell(mount, { ...context, gameStrings: GAME_LANG });
}
