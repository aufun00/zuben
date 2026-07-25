import { renderGameShell, renderControllerStatus } from "../common/game-shell.js";
import {
  COMMAND_PAUSE,
  COMMAND_RESUME,
  COMMAND_START,
  PHASE_ENDED,
  PHASE_INTRO,
  PHASE_PAUSED,
  PHASE_PREPARING,
  PHASE_RUNNING,
  createGameController,
} from "../common/game-controller.js";
import { createMatch3Engine } from "./engine.js";
import { MATCH3_ANIMATION_CFG, MATCH3_FLOW_CFG } from "./config.js";
import { GAME_LANG } from "./lang.js";
import { createGameResultView } from "../common/game-result.js";

ensureStylesheet();

export function renderGamePage(mount, context) {
  renderGameShell(mount, { ...context, gameStrings: GAME_LANG, setupGame: setupMatch3 });
}

function setupMatch3({ page, stage, game, gameIdx, parsed, durationMs, ghostScore, strings, localized }) {
  let activeStrings = strings;
  let activeLocalized = localized;
  stage.classList.add("match3-stage");
  stage.innerHTML = `
    <div class="match3-board" role="grid" aria-label="${localized.board}" data-board></div>
    <div class="match3-cover" data-cover>
      <div class="rules-card match3-rules">
        <h1 data-instructions-title></h1>
        <p data-rules-copy></p>
        <ol>
          <li data-operation-select></li>
          <li data-operation-swap></li>
          <li data-operation-score></li>
        </ol>
      </div>
    </div>
    <div class="match3-overlay" data-overlay hidden></div>
    <output class="countdown" data-countdown hidden></output>
  `;

  const boardElement = stage.querySelector("[data-board]");
  const cover = stage.querySelector("[data-cover]");
  const overlay = stage.querySelector("[data-overlay]");
  const engine = createMatch3Engine(parsed.seed, durationMs);
  let selectedIndex = null;
  let boardSignature = "";
  let destroyed = false;
  let lastSnapshot = null;
  let resultView = null;
  renderInstructionText();

  function renderBoard(board, clearing = []) {
    const clearingSet = new Set(clearing);
    boardSignature = board.join(",");
    if (boardElement.children.length !== board.length) {
      boardElement.innerHTML = board.map((_, index) => {
        const x = index % 8;
        const y = Math.floor(index / 8);
        return `<button class="match3-tile" type="button" role="gridcell" data-index="${index}" aria-label="${activeLocalized.tile} ${y + 1}, ${x + 1}"></button>`;
      }).join("");
    }
    [...boardElement.children].forEach((tile, index) => {
      tile.dataset.color = String(board[index]);
      tile.classList.toggle("selected", index === selectedIndex);
      tile.classList.toggle("clearing", clearingSet.has(index));
    });
  }

  async function settleSteps(steps) {
    for (const step of steps) {
      if (destroyed) return;
      renderBoard(step.board, step.kind === "clear" ? step.cells : []);
      await wait(animationDuration(step.kind));
    }
  }

  function onChange(snapshot) {
    lastSnapshot = snapshot;
    renderControllerStatus(page, snapshot, ghostScore, activeStrings);
    stage.dataset.phase = snapshot.phase;
    cover.hidden = snapshot.phase !== PHASE_INTRO && snapshot.phase !== PHASE_PAUSED && snapshot.phase !== PHASE_PREPARING;
    boardElement.setAttribute("aria-disabled", String(snapshot.phase !== PHASE_RUNNING));
    const signature = snapshot.game.board.join(",");
    if (signature !== boardSignature) renderBoard(snapshot.game.board);

    overlay.hidden = snapshot.phase !== PHASE_ENDED;
    if (snapshot.phase === PHASE_ENDED && !resultView) {
      resultView = createGameResultView({
        overlay, gameIdx, game, parsed, result: snapshot.result, ghostScore,
        language: document.documentElement.lang.startsWith("zh") ? "zh" : "en",
        strings: activeStrings, localized: activeLocalized,
      });
    }
  }

  const controller = createGameController({
    limitMs: durationMs,
    engine,
    initializeGame: () => engine.initialize(),
    settleSteps,
    onChange,
    flowCfg: MATCH3_FLOW_CFG,
  });

  page.querySelector(".game-control").addEventListener("click", () => {
    const phase = controller.snapshot().phase;
    if (phase === PHASE_INTRO) controller.command(COMMAND_START);
    else if (phase === PHASE_RUNNING) controller.command(COMMAND_PAUSE);
    else if (phase === PHASE_PAUSED) controller.command(COMMAND_RESUME);
  });

  boardElement.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-index]");
    if (!tile || lastSnapshot?.phase !== PHASE_RUNNING) return;
    const index = Number(tile.dataset.index);
    if (selectedIndex === null || selectedIndex === index || !areAdjacentIndices(selectedIndex, index)) {
      selectedIndex = selectedIndex === index ? null : index;
      updateSelection();
      return;
    }
    const from = indexToCell(selectedIndex);
    const to = indexToCell(index);
    selectedIndex = null;
    updateSelection();
    controller.submitAction({ from, to });
  });

  boardElement.addEventListener("keydown", (event) => {
    const tile = event.target.closest("[data-index]");
    if (!tile) return;
    const index = Number(tile.dataset.index);
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 };
    const delta = moves[event.key];
    if (!delta) return;
    const next = index + delta;
    if (next < 0 || next >= 64 || (delta === -1 && index % 8 === 0) || (delta === 1 && index % 8 === 7)) return;
    event.preventDefault();
    boardElement.querySelector(`[data-index="${next}"]`)?.focus();
  });

  const onVisibility = () => controller.handleVisibility(document.hidden);
  document.addEventListener("visibilitychange", onVisibility);

  function updateSelection() {
    boardElement.querySelectorAll(".selected").forEach((tile) => tile.classList.remove("selected"));
    if (selectedIndex !== null) boardElement.querySelector(`[data-index="${selectedIndex}"]`)?.classList.add("selected");
  }

  function renderInstructionText() {
    stage.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    stage.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    stage.querySelector("[data-operation-select]").textContent = activeLocalized.operationSelect;
    stage.querySelector("[data-operation-swap]").textContent = activeLocalized.operationSwap;
    stage.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
  }

  return {
    setLanguage({ strings: nextStrings, localized: nextLocalized }) {
      activeStrings = nextStrings;
      activeLocalized = nextLocalized;
      boardElement.setAttribute("aria-label", activeLocalized.board);
      [...boardElement.children].forEach((tile, index) => {
        tile.setAttribute("aria-label", `${activeLocalized.tile} ${Math.floor(index / 8) + 1}, ${index % 8 + 1}`);
      });
      renderInstructionText();
      resultView?.setLanguage({ language: document.documentElement.lang.startsWith("zh") ? "zh" : "en", strings: activeStrings, localized: activeLocalized });
      if (lastSnapshot) onChange(lastSnapshot);
    },
    cleanup() {
      destroyed = true;
      controller.destroy();
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

function indexToCell(index) {
  return { x: index % 8, y: Math.floor(index / 8) };
}

function areAdjacentIndices(first, second) {
  const a = indexToCell(first);
  const b = indexToCell(second);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function animationDuration(kind) {
  if (kind === "swap") return MATCH3_ANIMATION_CFG.swapMs;
  if (kind === "swapBack") return MATCH3_ANIMATION_CFG.swapBackMs;
  if (kind === "clear") return MATCH3_ANIMATION_CFG.clearMs;
  return MATCH3_ANIMATION_CFG.fallMs;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function ensureStylesheet() {
  const href = new URL("./game.css", import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}
