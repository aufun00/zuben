import { disposeGamePageResources, ensureGameStylesheet, failGamePage, formatRemaining, handleGameVisibilityChange, renderControllerFailure, renderGameShell, updateGameControlButton, updateGamePhasePresentation, updateGameSurfaceState, updateTugBar } from "../common/game-shell.js";
import { updateGameBarCharge } from "../common/game-bar-charge.js";
import { updateGameResultView } from "../common/game-result.js";
import { bindGameInput } from "../common/gesture-input.js";
import { cfg, MATCH3_PERFORMANCE_CFG } from "./config.js";
import { areAdjacentIndices } from "./engine.js";
import { GAME_LANG } from "./lang.js";
import { createMatch3Renderer } from "./render.js";
import { PHASE_ENDED, PHASE_RUNNING, OPERATION_IDLE, createMatch3Runtime } from "./runtime.js";

ensureGameStylesheet(import.meta.url);
export function renderGamePage(mount, context) { renderGameShell(mount, { ...context, gameStrings: GAME_LANG, setupGame: setupMatch3, performanceMeterCfg: MATCH3_PERFORMANCE_CFG }); }

function setupMatch3({ page, gameZone, game, gameIdx, parsed, durationMs, ghostScore, strings, localized, performanceMeter }) {
  let activeStrings = strings, activeLocalized = localized, latest = null, resultView = null, input = null, renderer = null, runtime = null;
  let selected = null, activeIndex = 0, focusBoardOnRun = false, destroyed = false, failed = false, assetsReady = false, failureCode = null, force = true;
  gameZone.classList.add("match3-zone");
  gameZone.innerHTML = `
    <div class="match3-playfield" data-match3-playfield role="application">
      <div class="match3-board" data-match3-board role="grid"></div>
    </div>
    <div class="match3-cover" data-match3-cover><div class="rules-card match3-rules">
      <h1 data-title></h1><p data-rules></p><ol><li data-select></li><li data-box></li><li data-score-rule></li></ol>
    </div></div>
    <div class="match3-overlay game-result-overlay" data-match3-overlay hidden></div>`;
  const playfield = gameZone.querySelector("[data-match3-playfield]"), board = gameZone.querySelector("[data-match3-board]");
  const cover = gameZone.querySelector("[data-match3-cover]"), overlay = gameZone.querySelector("[data-match3-overlay]");
  try {
    runtime = createMatch3Runtime({ cfg, seed: parsed.seed, limitMS: durationMs, onSnapshot, onPump: performanceMeter.recordTick, onError });
    renderer = createMatch3Renderer({ gameZone, runtime, performanceMeter });
    renderer.ready.then(() => {
      if (destroyed || failed) return;
      assetsReady = true;
      if (latest) onSnapshot(latest);
    }, (error) => { if (!destroyed && !failed) onError(error, "INIT"); });
  } catch (error) { onError(error, "INIT"); return { cleanup() {} }; }
  const gameButton = page.querySelector(".game-button");
  gameButton.addEventListener("pointerdown", () => { focusBoardOnRun = false; });
  gameButton.addEventListener("keydown", (event) => {
    if (!event.repeat && (event.key === "Enter" || event.key === " ")) focusBoardOnRun = true;
  });
  gameButton.addEventListener("click", () => { if (assetsReady) runtime.enqueueGameBarClick(performance.now()); });
  input = bindGameInput(board, {
    recognizer: "tap-swipe", thresholdPx: cfg.SwipeThresholdPx,
    resolveContext(event) { const tile = event.target.closest?.("[data-index]"); return tile && board.contains(tile) ? Object.freeze({ index: Number(tile.dataset.index) }) : null; },
    handle(event) {
      if (event.type === "tap") tap(event.context.index);
      else if (event.type === "swipe") swipe(event.context.index, event.direction);
      else if (event.type === "direction") keyboard(event.context.index, event.direction);
    },
  });
  board.addEventListener("focusin", (event) => { const tile = event.target.closest?.("[data-index]"); if (tile) { activeIndex = Number(tile.dataset.index); updateTabs(); } });
  document.addEventListener("visibilitychange", visibility);
  text(); onSnapshot(runtime.snapshot());

  function canAct() { return latest?.phase === PHASE_RUNNING && latest.operation === OPERATION_IDLE && !latest.settling; }
  function tap(index) {
    activeIndex = index; updateTabs(); if (!canAct()) return;
    if (selected === index) return select(null);
    if (selected === null || !areAdjacentIndices(selected, index, cfg.BoardSize)) return select(index);
    submit(selected, index);
  }
  function swipe(index, direction) {
    if (!canAct()) return; const row = Math.floor(index / cfg.BoardSize), column = index % cfg.BoardSize;
    const delta = { north: -cfg.BoardSize, east: 1, south: cfg.BoardSize, west: -1 }[direction];
    if (delta === undefined || direction === "north" && row === 0 || direction === "south" && row === cfg.BoardSize - 1 || direction === "west" && column === 0 || direction === "east" && column === cfg.BoardSize - 1) return select(null);
    submit(index, index + delta);
  }
  function keyboard(index, direction) { const delta = { north: -cfg.BoardSize, east: 1, south: cfg.BoardSize, west: -1 }[direction]; if (delta === undefined) return; const next = index + delta; if (next >= 0 && next < cfg.BoardSize ** 2 && (Math.abs(delta) !== 1 || Math.floor(next / cfg.BoardSize) === Math.floor(index / cfg.BoardSize))) { activeIndex = next; updateTabs(); board.querySelector(`[data-index="${next}"]`)?.focus(); } }
  function submit(from, to) { select(null); runtime.enqueueAction(from, to, performance.now()); }
  function select(index) { selected = index; renderer?.setSelected(index); }
  function updateTabs() { board.querySelectorAll("[data-index]").forEach((tile) => { tile.tabIndex = canAct() && Number(tile.dataset.index) === activeIndex ? 0 : -1; }); }
  function onSnapshot(snapshot) {
    if (destroyed || failed || !snapshot) return; const previousPhase = latest?.phase; latest = snapshot;
    if (!canAct()) select(null);
    const phaseChanged = updateGamePhasePresentation({ gameZone, playfield, performanceMeter }, { phase: snapshot.phase, previousPhase, settling: snapshot.settling }); gameZone.dataset.operation = snapshot.operation;
    page.querySelector("[data-time]").textContent = formatRemaining(snapshot.remainingMS);
    const ghostElapsed = snapshot.phase === PHASE_ENDED ? durationMs : snapshot.runGT; updateTugBar(page, snapshot.score, ghostScore, activeStrings, ghostElapsed, durationMs);
    updateGameBarCharge(page, { value: snapshot.energy, greenThreshold: cfg.EnergyGreenThreshold, orangeThreshold: cfg.EnergyOrangeThreshold, purpleThreshold: cfg.EnergyPurpleThreshold, label: activeLocalized.energy });
    const button = page.querySelector(".game-button");
    updateGameControlButton(button, snapshot.phase, activeStrings);
    if (!assetsReady) button.disabled = true;
    updateGameSurfaceState({ cover, overlay }, snapshot.phase); board.setAttribute("aria-disabled", String(!canAct())); updateTabs();
    if (phaseChanged && snapshot.phase === PHASE_RUNNING) {
      if (focusBoardOnRun) board.querySelector(`[data-index="${activeIndex}"]`)?.focus({ preventScroll: true });
      focusBoardOnRun = false;
    }
    ({ input, resultView } = updateGameResultView({ phase: snapshot.phase, resultView, input, overlay, gameIdx, game, parsed, result: snapshot.result, ghostScore, language: document.documentElement.lang.startsWith("zh") ? "zh" : "en", strings: activeStrings, localized: activeLocalized }));
    force = false;
  }
  function visibility() { handleGameVisibilityChange({ hidden: document.hidden, input, runtime, renderer }); }
  function onError(error, stage = "RUNTIME") { failed = true; const failure = failGamePage({ gameID: game.gameID, stage, error, page, strings: activeStrings, visibilityHandler: visibility, input, renderer, runtime }); input = failure.input; renderer = failure.renderer; runtime = failure.runtime; failureCode = failure.errorCode; }
  function text() { gameZone.querySelector("[data-title]").textContent = activeLocalized.instructionsTitle; gameZone.querySelector("[data-rules]").textContent = activeLocalized.rules; gameZone.querySelector("[data-select]").textContent = activeLocalized.operationSelect; gameZone.querySelector("[data-box]").textContent = activeLocalized.operationMystery; gameZone.querySelector("[data-score-rule]").textContent = activeLocalized.operationScore; board.setAttribute("aria-label", activeLocalized.board); board.querySelectorAll("[data-index]").forEach((tile, index) => tile.setAttribute("aria-label", `${activeLocalized.tile} ${Math.floor(index / cfg.BoardSize) + 1}, ${index % cfg.BoardSize + 1}`)); }
  return { setLanguage({ strings: nextStrings, localized: nextLocalized }) { activeStrings = nextStrings; activeLocalized = nextLocalized; if (failed) { renderControllerFailure(page, activeStrings, failureCode); return; } text(); force = true; resultView?.setLanguage({ language: document.documentElement.lang.startsWith("zh") ? "zh" : "en", strings: activeStrings, localized: activeLocalized }); if (latest) onSnapshot(latest); }, cleanup() { if (destroyed) return; destroyed = true; ({ input, renderer, runtime } = disposeGamePageResources({ visibilityHandler: visibility, input, renderer, runtime })); } };
}
