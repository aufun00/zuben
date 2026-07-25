import { renderGameShell, renderControllerFailure, renderControllerStatus } from "../common/game-shell.js";
import {
  COMMAND_PAUSE,
  COMMAND_RESUME,
  COMMAND_START,
  PHASE_ENDED,
  PHASE_INTRO,
  PHASE_PAUSED,
  PHASE_PREPARING,
  PHASE_RUNNING,
  PHASE_SETTLING,
  createGameController,
} from "../common/game-controller.js";
import { createMatch3Engine } from "./engine.js";
import { MATCH3_ANIMATION_CFG, MATCH3_BOARD_CFG, MATCH3_FLOW_CFG } from "./config.js";
import { GAME_LANG } from "./lang.js";
import { createGameResultView } from "../common/game-result.js";
import { bindGestureInput } from "../common/gesture-input.js";

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
  const boardWidth = MATCH3_BOARD_CFG.width;
  const boardHeight = MATCH3_BOARD_CFG.height;
  const boardSize = boardWidth * boardHeight;
  boardElement.style.setProperty("--match3-columns", String(boardWidth));
  boardElement.style.setProperty("--match3-aspect", `${boardWidth} / ${boardHeight}`);
  const cover = stage.querySelector("[data-cover]");
  const overlay = stage.querySelector("[data-overlay]");
  const engine = createMatch3Engine(parsed.seed, durationMs);
  let selectedIndex = null;
  let activeIndex = 0;
  let boardSignature = "";
  let destroyed = false;
  let lastSnapshot = null;
  let resultView = null;
  let failed = false;
  renderInstructionText();

  function renderBoard(board, clearing = []) {
    const clearingSet = new Set(clearing);
    boardSignature = board.join(",");
    if (boardElement.children.length !== board.length) {
      boardElement.innerHTML = board.map((_, index) => {
        const x = index % boardWidth;
        const y = Math.floor(index / boardWidth);
        return `<button class="match3-tile" type="button" role="gridcell" tabindex="-1" data-index="${index}" aria-label="${activeLocalized.tile} ${y + 1}, ${x + 1}"></button>`;
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
    cover.hidden = !snapshot.concealed && snapshot.phase !== PHASE_INTRO && snapshot.phase !== PHASE_PAUSED && snapshot.phase !== PHASE_PREPARING;
    boardElement.setAttribute("aria-disabled", String(snapshot.phase !== PHASE_RUNNING));
    updateBoardTabStops(snapshot.phase);
    const signature = snapshot.game.board.join(",");
    if (snapshot.phase !== PHASE_SETTLING && signature !== boardSignature) renderBoard(snapshot.game.board);

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
    onError: (error) => {
      console.error("Match3 controller failed", error);
      failed = true;
      renderControllerFailure(page, activeStrings);
    },
    flowCfg: MATCH3_FLOW_CFG,
  });

  page.querySelector(".game-control").addEventListener("click", () => {
    const phase = controller.snapshot().phase;
    if (phase === PHASE_INTRO) controller.command(COMMAND_START);
    else if (phase === PHASE_RUNNING) controller.command(COMMAND_PAUSE);
    else if (phase === PHASE_PAUSED) controller.command(COMMAND_RESUME);
  });

  const unbindGesture = bindGestureInput(boardElement, {
    begin(event) {
      if (lastSnapshot?.phase !== PHASE_RUNNING) return null;
      const tile = event.target.closest?.("[data-index]");
      if (!tile || !boardElement.contains(tile)) return null;
      const index = Number(tile.dataset.index);
      return {
        tapAction: { kind: "tap", index },
        directions: swipeActions(index),
      };
    },
    commit(action) {
      if (action.kind === "tap") activateTile(action.index);
      else if (action.kind === "swap") submitSwap(action.from, action.to);
    },
  });

  function activateTile(index) {
    setActiveIndex(index, false);
    if (lastSnapshot?.phase !== PHASE_RUNNING) return;
    if (selectedIndex === null || selectedIndex === index || !areAdjacentIndices(selectedIndex, index)) {
      selectedIndex = selectedIndex === index ? null : index;
      updateSelection();
      return;
    }
    submitSwap(selectedIndex, index);
  }

  function submitSwap(fromIndex, toIndex) {
    const from = indexToCell(fromIndex);
    const to = indexToCell(toIndex);
    selectedIndex = null;
    updateSelection();
    void controller.submitAction({ from, to }).catch(() => {});
  }

  function swipeActions(index) {
    const actions = {};
    const x = index % boardWidth;
    const y = Math.floor(index / boardWidth);
    if (y > 0) actions.up = { kind: "swap", from: index, to: index - boardWidth };
    if (x < boardWidth - 1) actions.right = { kind: "swap", from: index, to: index + 1 };
    if (y < boardHeight - 1) actions.down = { kind: "swap", from: index, to: index + boardWidth };
    if (x > 0) actions.left = { kind: "swap", from: index, to: index - 1 };
    return actions;
  }

  boardElement.addEventListener("keydown", (event) => {
    const tile = event.target.closest("[data-index]");
    if (!tile) return;
    const index = Number(tile.dataset.index);
    if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
      event.preventDefault();
      activateTile(index);
      return;
    }
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -boardWidth, ArrowDown: boardWidth };
    const delta = moves[event.key];
    if (!delta) return;
    const next = index + delta;
    if (next < 0 || next >= boardSize || (delta === -1 && index % boardWidth === 0) || (delta === 1 && index % boardWidth === boardWidth - 1)) return;
    event.preventDefault();
    setActiveIndex(next, true);
  });
  boardElement.addEventListener("focusin", (event) => {
    const tile = event.target.closest?.("[data-index]");
    if (tile) setActiveIndex(Number(tile.dataset.index), false);
  });

  const syncInterruption = () => controller.handleInterruption(document.hidden || !document.hasFocus());
  const onBlur = () => controller.handleInterruption(true);
  const onFocus = () => syncInterruption();
  const onVisibility = () => syncInterruption();
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);

  function updateSelection() {
    boardElement.querySelectorAll(".selected").forEach((tile) => tile.classList.remove("selected"));
    if (selectedIndex !== null) boardElement.querySelector(`[data-index="${selectedIndex}"]`)?.classList.add("selected");
  }

  function setActiveIndex(index, focus) {
    activeIndex = Math.max(0, Math.min(boardSize - 1, index));
    updateBoardTabStops(lastSnapshot?.phase);
    if (focus) boardElement.querySelector(`[data-index="${activeIndex}"]`)?.focus();
  }

  function updateBoardTabStops(phase) {
    boardElement.querySelectorAll("[data-index]").forEach((tile) => {
      tile.tabIndex = phase === PHASE_RUNNING && Number(tile.dataset.index) === activeIndex ? 0 : -1;
    });
  }

  function renderInstructionText() {
    stage.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    stage.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    stage.querySelector("[data-operation-select]").textContent = activeLocalized.operationSelect;
    stage.querySelector("[data-operation-swap]").textContent = activeLocalized.operationSwap;
    stage.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
  }

  function indexToCell(index) {
    return { x: index % boardWidth, y: Math.floor(index / boardWidth) };
  }

  function areAdjacentIndices(first, second) {
    const a = indexToCell(first);
    const b = indexToCell(second);
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
  }

  return {
    setLanguage({ strings: nextStrings, localized: nextLocalized }) {
      activeStrings = nextStrings;
      activeLocalized = nextLocalized;
      if (failed) {
        renderControllerFailure(page, activeStrings);
        return;
      }
      boardElement.setAttribute("aria-label", activeLocalized.board);
      [...boardElement.children].forEach((tile, index) => {
        tile.setAttribute("aria-label", `${activeLocalized.tile} ${Math.floor(index / boardWidth) + 1}, ${index % boardWidth + 1}`);
      });
      renderInstructionText();
      resultView?.setLanguage({ language: document.documentElement.lang.startsWith("zh") ? "zh" : "en", strings: activeStrings, localized: activeLocalized });
      if (lastSnapshot) onChange(lastSnapshot);
    },
    cleanup() {
      destroyed = true;
      unbindGesture();
      controller.destroy();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
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
