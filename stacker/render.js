import { cfg, STACKER_SHAPES } from "./config.js";
import { PHASE_ENDED } from "./runtime.js";
import { createStackerSound } from "./sound.js";

const SHAPES_BY_ID = new Map(STACKER_SHAPES.map((shape) => [shape.id, shape]));

export function createStackerRenderer({
  gameZone,
  runtime,
  performanceMeter,
  readBN = () => performance.now(),
} = {}) {
  const scene = gameZone.querySelector("[data-scene]");
  const camera = scene.querySelector("[data-camera]");
  const staticTower = scene.querySelector("[data-static-tower]");
  const footprintLayer = scene.querySelector("[data-footprint]");
  const movingLayer = scene.querySelector("[data-moving]");
  const gamePage = gameZone.closest(".game-page");
  const soundSurface = gamePage?.querySelector(".game-button") ?? gamePage ?? gameZone;
  const sound = createStackerSound({ surface: soundSurface });
  let renderedLayers = 0;
  let footprintKey = "";
  let movingKey = "";
  let cameraY = null;
  let timer = null;
  let visible = !document.hidden;
  let destroyed = false;

  staticTower.replaceChildren();
  staticTower.insertAdjacentHTML("beforeend", renderBase());

  function render() {
    timer = null;
    if (destroyed || !visible) return;
    const BN = readBN();
    if (runtime.shouldYieldRender(BN)) {
      runtime.wakePump();
      schedule(0);
      return;
    }
    const snapshot = runtime.snapshot();
    if (snapshot) { sound.sync(snapshot); paint(snapshot); }
    performanceMeter.recordFrame(readBN());
    schedule();
  }

  function paint(snapshot) {
    while (renderedLayers < snapshot.layers.length) {
      const layer = snapshot.layers[renderedLayers];
      const shape = requireShape(layer.shapeID);
      staticTower.insertAdjacentHTML("beforeend", renderLayer(shape.mesh, layer.footprint, layer.number, layer.color, "landed"));
      renderedLayers += 1;
    }

    const nextCameraY = Math.max(0, snapshot.layerCount - 10) * cfg.LayerHeightPx;
    if (nextCameraY !== cameraY) {
      camera.setAttribute("transform", `translate(0 ${nextCameraY})`);
      cameraY = nextCameraY;
    }

    const nextFootprintKey = `${snapshot.footprint.x}:${snapshot.footprint.z}:${snapshot.footprint.width}:${snapshot.footprint.depth}:${snapshot.layerCount}`;
    if (nextFootprintKey !== footprintKey) {
      footprintLayer.innerHTML = renderFootprint(snapshot.footprint, snapshot.layerCount + 0.04);
      footprintKey = nextFootprintKey;
    }

    gameZone.classList.toggle("is-landing", snapshot.transition?.kind === "land");
    gameZone.classList.toggle("is-miss", snapshot.transition?.kind === "miss");
    if (snapshot.phase === PHASE_ENDED || snapshot.settling) {
      movingLayer.hidden = true;
      return;
    }

    const moving = snapshot.transition?.kind === "miss" ? snapshot.transition.placed : snapshot.moving;
    const level = snapshot.layerCount + 1;
    const nextMovingKey = `${moving.shapeID}:${moving.width}:${moving.depth}:${level}`;
    if (nextMovingKey !== movingKey) {
      const shape = requireShape(moving.shapeID);
      movingLayer.innerHTML = renderSurfacePaths(shape.mesh, { x: 0, z: 0, width: moving.width, depth: moving.depth }, level, moving.color);
      movingKey = nextMovingKey;
    }
    const translation = projectTranslation(moving.x, moving.z);
    movingLayer.setAttribute("transform", `translate(${translation.x} ${translation.y})`);
    movingLayer.hidden = false;
  }

  function schedule(delay = cfg.RenderWaitMS) {
    if (!destroyed && visible && timer === null) timer = setTimeout(render, delay);
  }

  render();
  return Object.freeze({
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      sound.setVisible(visible);
      if (!visible && timer !== null) { clearTimeout(timer); timer = null; }
      else if (visible) render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      sound.destroy();
    },
  });
}

function requireShape(shapeID) {
  const shape = SHAPES_BY_ID.get(shapeID);
  if (!shape) throw new Error(`unknown Stacker shape: ${shapeID}`);
  return shape;
}

function renderBase() {
  const size = cfg.BaseSize * cfg.LogicScale;
  const mesh = {
    topRects: [{ x: 0, z: 0, width: cfg.GridSize, depth: cfg.GridSize }],
    xEdges: [{ constant: cfg.GridSize, start: 0, end: cfg.GridSize }],
    zEdges: [{ constant: cfg.GridSize, start: 0, end: cfg.GridSize }],
  };
  return renderLayer(mesh, { x: 0, z: 0, width: size, depth: size }, 0, "#303a55", "base");
}

function renderLayer(mesh, envelope, level, color, kind) {
  return `<g class="stacker-layer ${kind}" data-layer="${level}">${renderSurfacePaths(mesh, envelope, level, color)}</g>`;
}

function renderSurfacePaths(mesh, envelope, level, color) {
  const sideX = mesh.xEdges.map((edge) => polygonPath(xSideFace(fitXEdge(edge, envelope), level))).join("");
  const sideZ = mesh.zEdges.map((edge) => polygonPath(zSideFace(fitZEdge(edge, envelope), level))).join("");
  const top = mesh.topRects.map((rect) => polygonPath(topFace(fitRect(rect, envelope), level))).join("");
  return `<path class="surface-side surface-side-x" d="${sideX}" fill="${shade(color, .58)}"/><path class="surface-side surface-side-z" d="${sideZ}" fill="${shade(color, .72)}"/><path class="surface-top" d="${top}" fill="${color}"/>`;
}

function fitRect(rect, envelope) {
  return { x: envelope.x + rect.x * envelope.width / cfg.GridSize, z: envelope.z + rect.z * envelope.depth / cfg.GridSize, width: rect.width * envelope.width / cfg.GridSize, depth: rect.depth * envelope.depth / cfg.GridSize };
}

function fitXEdge(edge, envelope) {
  return { constant: envelope.x + edge.constant * envelope.width / cfg.GridSize, start: envelope.z + edge.start * envelope.depth / cfg.GridSize, end: envelope.z + edge.end * envelope.depth / cfg.GridSize };
}

function fitZEdge(edge, envelope) {
  return { constant: envelope.z + edge.constant * envelope.depth / cfg.GridSize, start: envelope.x + edge.start * envelope.width / cfg.GridSize, end: envelope.x + edge.end * envelope.width / cfg.GridSize };
}

function topFace(rect, level) {
  return [project(rect.x, rect.z, level), project(rect.x + rect.width, rect.z, level), project(rect.x + rect.width, rect.z + rect.depth, level), project(rect.x, rect.z + rect.depth, level)];
}

function xSideFace(edge, level) {
  return extrude(project(edge.constant, edge.start, level), project(edge.constant, edge.end, level));
}

function zSideFace(edge, level) {
  return extrude(project(edge.end, edge.constant, level), project(edge.start, edge.constant, level));
}

function extrude(start, end) {
  return [start, end, { x: end.x, y: end.y + cfg.LayerHeightPx }, { x: start.x, y: start.y + cfg.LayerHeightPx }];
}

function renderFootprint(rect, level) {
  const points = [project(rect.x, rect.z, level), project(rect.x + rect.width, rect.z, level), project(rect.x + rect.width, rect.z + rect.depth, level), project(rect.x, rect.z + rect.depth, level)];
  return `<polygon class="footprint-guide" points="${points.map(point).join(" ")}"/>`;
}

function project(x, z, level) {
  const worldX = x / cfg.LogicScale;
  const worldZ = z / cfg.LogicScale;
  return { x: 300 + (worldX - worldZ) * 34, y: 410 + (worldX + worldZ - cfg.BaseSize) * 17 - level * cfg.LayerHeightPx };
}

function projectTranslation(x, z) {
  return { x: (x - z) * 34 / cfg.LogicScale, y: (x + z) * 17 / cfg.LogicScale };
}

function polygonPath(points) {
  return `M${points.map(point).join("L")}Z`;
}

function point(value) {
  return `${value.x},${value.y}`;
}

function shade(hex, factor) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [value >> 16, value >> 8 & 255, value & 255].map((channel) => Math.round(channel * factor));
  return `rgb(${channels.join(",")})`;
}
