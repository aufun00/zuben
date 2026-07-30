import { renderGameShell, renderControllerFailure, renderControllerStatus } from "../common/game-shell.js";
import {
  COMMAND_PAUSE, COMMAND_RESUME, COMMAND_START,
  PHASE_ENDED, PHASE_INTRO, PHASE_PAUSED, PHASE_PREPARING, PHASE_RUNNING, PHASE_SETTLING,
  createGameController,
} from "../common/game-controller.js";
import { createGameResultView } from "../common/game-result.js";
import { STACKER_ANIMATION_CFG, STACKER_BOARD_CFG, STACKER_FLOW_CFG, STACKER_RENDER_CFG, STACKER_SHAPES } from "./config.js";
import { createStackerEngine } from "./engine.js";
import { GAME_LANG } from "./lang.js";
import { bindGameInput } from "../common/gesture-input.js";

const SHAPES_BY_ID = new Map(STACKER_SHAPES.map((shape) => [shape.id, shape]));

ensureStylesheet();

export function renderGamePage(mount, context) {
  renderGameShell(mount, { ...context, gameStrings: GAME_LANG, setupGame: setupStacker });
}

function setupStacker({ page, gameZone, game, gameIdx, parsed, durationMs, ghostScore, strings, localized, performanceMeter }) {
  let activeStrings = strings;
  let activeLocalized = localized;
  let lastSnapshot = null;
  let resultView = null;
  let failed = false;
  let stackerInput = null;
  gameZone.classList.add("stacker-zone");
  gameZone.style.setProperty("--stacker-land-ms", `${STACKER_ANIMATION_CFG.landMs}ms`);
  gameZone.innerHTML = `
    <div class="stacker-playfield" data-playfield role="button" tabindex="-1">
      <svg class="stacker-scene" data-scene viewBox="0 0 600 620" role="img">
        <g data-camera>
          <g data-static-tower></g>
          <g data-footprint></g>
          <g class="stacker-layer moving" data-moving></g>
        </g>
      </svg>
      <div class="stacker-readout" aria-live="polite"><span data-layer-readout></span><span data-shape-readout></span></div>
    </div>
    <div class="stacker-cover" data-cover>
      <div class="rules-card stacker-rules">
        <h1 data-instructions-title></h1>
        <p data-rules-copy></p>
        <ol><li data-operation-drop></li><li data-operation-footprint></li><li data-operation-score></li></ol>
      </div>
    </div>
    <div class="stacker-overlay game-result-overlay" data-overlay hidden></div>
    <output class="countdown" data-countdown hidden></output>
  `;

  const playfield = gameZone.querySelector("[data-playfield]");
  const scene = playfield.querySelector("[data-scene]");
  const camera = scene.querySelector("[data-camera]");
  const staticTower = scene.querySelector("[data-static-tower]");
  const footprintLayer = scene.querySelector("[data-footprint]");
  const movingLayer = scene.querySelector("[data-moving]");
  const layerReadout = gameZone.querySelector("[data-layer-readout]");
  const shapeReadout = gameZone.querySelector("[data-shape-readout]");
  const cover = gameZone.querySelector("[data-cover]");
  const overlay = gameZone.querySelector("[data-overlay]");
  const engine = createStackerEngine(parsed.seed, durationMs);
  let renderedLayerCount = 0;
  let movingRenderKey = "";
  let footprintRenderKey = "";
  let renderedCameraY = null;
  staticTower.insertAdjacentHTML("beforeend", renderBase());

  function onChange(snapshot) {
    lastSnapshot = snapshot;
    performanceMeter.setPhase(snapshot.phase);
    if (snapshot.phase !== PHASE_RUNNING) stackerInput?.cancelSession();
    renderControllerStatus(page, snapshot, ghostScore, activeStrings);
    gameZone.dataset.phase = snapshot.phase;
    cover.hidden = !snapshot.concealed && snapshot.phase !== PHASE_INTRO && snapshot.phase !== PHASE_PAUSED && snapshot.phase !== PHASE_PREPARING;
    playfield.setAttribute("aria-disabled", String(snapshot.phase !== PHASE_RUNNING));
    playfield.tabIndex = snapshot.phase === PHASE_RUNNING ? 0 : -1;
    renderScene(snapshot);
    overlay.hidden = snapshot.phase !== PHASE_ENDED;
    if (snapshot.phase === PHASE_ENDED && !resultView) {
      resultView = createGameResultView({
        overlay, gameIdx, game, parsed, result: snapshot.result, ghostScore,
        language: document.documentElement.lang.startsWith("zh") ? "zh" : "en",
        strings: activeStrings, localized: activeLocalized,
      });
    }
  }

  async function settleSteps(steps) {
    gameZone.classList.add(steps.some((step) => step.kind === "miss") ? "is-miss" : "is-landing");
    await wait(STACKER_ANIMATION_CFG.landMs);
    gameZone.classList.remove("is-miss", "is-landing");
  }

  const controller = createGameController({
    limitMs: durationMs,
    engine,
    applyAction: (action, remainMs, raceTimeMs) => engine.applyDrop(action, remainMs, raceTimeMs),
    settleSteps,
    onChange,
    onPump: performanceMeter.recordTick,
    onError: (error) => {
      console.error("Stacker controller failed", error);
      failed = true;
      stackerInput?.cancelSession();
      renderControllerFailure(page, activeStrings);
    },
    flowCfg: STACKER_FLOW_CFG,
  });

  page.querySelector(".game-button").addEventListener("click", () => {
    const phase = controller.snapshot().phase;
    if (phase === PHASE_INTRO) controller.command(COMMAND_START);
    else if (phase === PHASE_RUNNING) controller.command(COMMAND_PAUSE);
    else if (phase === PHASE_PAUSED) controller.command(COMMAND_RESUME);
  });

  const drop = () => {
    if (controller.snapshot().phase !== PHASE_RUNNING) return;
    void controller.submitAction({ kind: "drop" }).catch(() => {});
  };
  stackerInput = bindGameInput(playfield, {
    recognizer: "press",
    handle(inputEvent) {
      if (inputEvent.type === "press") drop();
    },
  });
  const syncInterruption = () => controller.handleInterruption(document.hidden || !document.hasFocus());
  const onBlur = () => controller.handleInterruption(true);
  const onFocus = () => syncInterruption();
  const onVisibility = () => syncInterruption();
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  renderInstructionText();

  function renderInstructionText() {
    playfield.setAttribute("aria-label", `${activeLocalized.tower}. ${activeLocalized.drop}`);
    scene.setAttribute("aria-label", activeLocalized.tower);
    gameZone.querySelector("[data-instructions-title]").textContent = activeLocalized.instructionsTitle;
    gameZone.querySelector("[data-rules-copy]").textContent = activeLocalized.rules;
    gameZone.querySelector("[data-operation-drop]").textContent = activeLocalized.operationDrop;
    gameZone.querySelector("[data-operation-footprint]").textContent = activeLocalized.operationFootprint;
    gameZone.querySelector("[data-operation-score]").textContent = activeLocalized.operationScore;
  }

  function renderScene(snapshot) {
    const gameState = snapshot.game;
    const moving = engine.getMovingAt(snapshot.raceTimeMs);
    const cameraY = Math.max(0, gameState.layerCount - 10) * STACKER_RENDER_CFG.layerHeightPx;
    while (renderedLayerCount < gameState.layers.length) {
      const layer = gameState.layers[renderedLayerCount];
      const shape = SHAPES_BY_ID.get(layer.shapeID);
      staticTower.insertAdjacentHTML("beforeend", renderLayer(shape.mesh, layer.footprint, layer.number, layer.color, "landed"));
      renderedLayerCount += 1;
    }
    if (cameraY !== renderedCameraY) {
      camera.setAttribute("transform", `translate(0 ${cameraY})`);
      renderedCameraY = cameraY;
    }
    const footprintKey = `${gameState.footprint.x}:${gameState.footprint.z}:${gameState.footprint.width}:${gameState.footprint.depth}:${gameState.layerCount}`;
    if (footprintKey !== footprintRenderKey) {
      footprintLayer.innerHTML = renderFootprint(gameState.footprint, gameState.layerCount + 0.04);
      footprintRenderKey = footprintKey;
    }
    if (snapshot.phase !== PHASE_ENDED && snapshot.phase !== PHASE_SETTLING) {
      const level = gameState.layerCount + 1;
      const renderKey = `${moving.shapeID}:${moving.width}:${moving.depth}:${level}`;
      if (renderKey !== movingRenderKey) {
        const shape = SHAPES_BY_ID.get(moving.shapeID);
        const localEnvelope = { x: 0, z: 0, width: moving.width, depth: moving.depth };
        movingLayer.innerHTML = renderSurfacePaths(shape.mesh, localEnvelope, level, moving.color);
        movingRenderKey = renderKey;
      }
      const translation = projectTranslation(moving.x, moving.z);
      movingLayer.setAttribute("transform", `translate(${translation.x} ${translation.y})`);
      movingLayer.hidden = false;
    } else {
      movingLayer.hidden = true;
    }
    layerReadout.textContent = `${activeLocalized.layer} ${gameState.layerCount}`;
    shapeReadout.textContent = activeLocalized.shapes[moving.shapeID] ?? moving.shapeID;
  }

  return {
    setLanguage({ strings: nextStrings, localized: nextLocalized }) {
      activeStrings = nextStrings;
      activeLocalized = nextLocalized;
      if (failed) {
        renderControllerFailure(page, activeStrings);
        return;
      }
      renderInstructionText();
      resultView?.setLanguage({
        language: document.documentElement.lang.startsWith("zh") ? "zh" : "en",
        strings: activeStrings,
        localized: activeLocalized,
      });
      if (lastSnapshot) onChange(lastSnapshot);
    },
    cleanup() {
      stackerInput.destroy();
      controller.destroy();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

function renderBase() {
  const scale = STACKER_BOARD_CFG.logicScale;
  const size = STACKER_BOARD_CFG.baseSize * scale;
  const sizeInCells = STACKER_BOARD_CFG.gridSize;
  const mesh = {
    topRects: [{ x: 0, z: 0, width: sizeInCells, depth: sizeInCells }],
    xEdges: [{ constant: sizeInCells, start: 0, end: sizeInCells }],
    zEdges: [{ constant: sizeInCells, start: 0, end: sizeInCells }],
  };
  return renderLayer(mesh, { x: 0, z: 0, width: size, depth: size }, 0, "#303a55", "base");
}

function renderLayer(mesh, envelope, level, color, kind) {
  return `<g class="stacker-layer ${kind}" data-layer="${level}">${renderSurfacePaths(mesh, envelope, level, color)}</g>`;
}

function renderSurfacePaths(mesh, envelope, level, color) {
  const sideXPath = mesh.xEdges.map((edge) => polygonPath(xSideFace(fitXEdge(edge, envelope), level))).join("");
  const sideZPath = mesh.zEdges.map((edge) => polygonPath(zSideFace(fitZEdge(edge, envelope), level))).join("");
  const topPath = mesh.topRects.map((rect) => polygonPath(topFace(fitRect(rect, envelope), level))).join("");
  return `<path class="surface-side surface-side-x" d="${sideXPath}" fill="${shade(color, .58)}"/><path class="surface-side surface-side-z" d="${sideZPath}" fill="${shade(color, .72)}"/><path class="surface-top" d="${topPath}" fill="${color}"/>`;
}

function fitRect(rect, envelope) {
  const size = STACKER_BOARD_CFG.gridSize;
  return {
    x: envelope.x + rect.x * envelope.width / size,
    z: envelope.z + rect.z * envelope.depth / size,
    width: rect.width * envelope.width / size,
    depth: rect.depth * envelope.depth / size,
  };
}

function fitXEdge(edge, envelope) {
  const size = STACKER_BOARD_CFG.gridSize;
  return {
    constant: envelope.x + edge.constant * envelope.width / size,
    start: envelope.z + edge.start * envelope.depth / size,
    end: envelope.z + edge.end * envelope.depth / size,
  };
}

function fitZEdge(edge, envelope) {
  const size = STACKER_BOARD_CFG.gridSize;
  return {
    constant: envelope.z + edge.constant * envelope.depth / size,
    start: envelope.x + edge.start * envelope.width / size,
    end: envelope.x + edge.end * envelope.width / size,
  };
}

function topFace(rect, level) {
  const a = project(rect.x, rect.z, level);
  const b = project(rect.x + rect.width, rect.z, level);
  const c = project(rect.x + rect.width, rect.z + rect.depth, level);
  const d = project(rect.x, rect.z + rect.depth, level);
  return [a, b, c, d];
}

function xSideFace(edge, level) {
  return extrudeEdge(project(edge.constant, edge.start, level), project(edge.constant, edge.end, level));
}

function zSideFace(edge, level) {
  return extrudeEdge(project(edge.end, edge.constant, level), project(edge.start, edge.constant, level));
}

function extrudeEdge(start, end) {
  const height = STACKER_RENDER_CFG.layerHeightPx;
  return [start, end, { x: end.x, y: end.y + height }, { x: start.x, y: start.y + height }];
}

function polygonPath(points) {
  return `M${points.map(point).join("L")}Z`;
}

function renderFootprint(rect, level) {
  const points = [
    project(rect.x, rect.z, level), project(rect.x + rect.width, rect.z, level),
    project(rect.x + rect.width, rect.z + rect.depth, level), project(rect.x, rect.z + rect.depth, level),
  ];
  return `<polygon class="footprint-guide" points="${points.map(point).join(" ")}"/>`;
}

function project(x, z, level) {
  const unit = STACKER_BOARD_CFG.logicScale;
  const worldX = x / unit;
  const worldZ = z / unit;
  return {
    x: 300 + (worldX - worldZ) * 34,
    y: 410 + (worldX + worldZ - STACKER_BOARD_CFG.baseSize) * 17 - level * STACKER_RENDER_CFG.layerHeightPx,
  };
}

function projectTranslation(x, z) {
  const unit = STACKER_BOARD_CFG.logicScale;
  return { x: (x - z) * 34 / unit, y: (x + z) * 17 / unit };
}

function point(value) { return `${value.x},${value.y}`; }

function shade(hex, factor) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [value >> 16, value >> 8 & 255, value & 255].map((channel) => Math.round(channel * factor));
  return `rgb(${channels.join(",")})`;
}

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function ensureStylesheet() {
  const href = new URL("./game.css", import.meta.url).href;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
}
