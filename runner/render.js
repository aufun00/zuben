import { cfg } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const OBJECT_POOL_SIZE = (Math.ceil(cfg.ViewDistance / cfg.StationGap) + 1) * 3;
const SYMBOL_IDS = Object.freeze({
  cone: "runner-cone",
  acceleration: "runner-acceleration",
  deceleration: "runner-deceleration",
  coin: "runner-coin",
  diamond: "runner-diamond",
});

export function createRunnerRenderer({ gameZone, road, objects, runtime, performanceMeter, readBN = () => performance.now() }) {
  const objectLayer = gameZone.querySelector("[data-road-objects]");
  const motorcycle = gameZone.querySelector("[data-motorcycle]");
  const speed = gameZone.querySelector("[data-runner-speed]");
  const hearts = [...gameZone.querySelectorAll("[data-runner-heart]")];
  const pool = Array.from({ length: OBJECT_POOL_SIZE }, () => {
    const node = document.createElementNS(SVG_NS, "use");
    node.classList.add("runner-road-object");
    node.setAttribute("x", "-50");
    node.setAttribute("y", "-50");
    node.setAttribute("width", "100");
    node.setAttribute("height", "100");
    node.hidden = true;
    objectLayer.append(node);
    return node;
  });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let renderTimer = null;
  let visible = !document.hidden;
  let destroyed = false;
  let visualX = 0;
  let targetLane = cfg.InitialLane;
  let transitionFrom = 0;
  let transitionStartedAt = 0;

  function render() {
    renderTimer = null;
    if (destroyed || !visible) return;
    const nowBN = readBN();
    if (runtime.shouldYieldRender(nowBN)) {
      runtime.wakePump();
      schedule();
      return;
    }
    const snapshot = runtime.snapshot();
    if (!snapshot) {
      schedule();
      return;
    }
    updateVisualLane(snapshot, nowBN);
    motorcycle.setAttribute("transform", `translate(${300 + visualX * 162} 674)`);
    speed.textContent = `${(snapshot.runSpeed / cfg.NormalSpeed).toFixed(2)}×`;
    hearts.forEach((heart, index) => {
      heart.setAttribute("href", index < snapshot.runBlood ? "#runner-heart" : "#runner-heart-empty");
    });
    renderRoad(snapshot);
    performanceMeter.recordFrame(readBN());
    schedule();
  }

  function updateVisualLane(snapshot, nowBN) {
    const nextTarget = snapshot.runLane - 1;
    if (snapshot.phase !== "PHASE_RUNNING" || reducedMotion.matches) {
      visualX = nextTarget;
      targetLane = snapshot.runLane;
      transitionFrom = visualX;
      transitionStartedAt = nowBN;
      return;
    }
    if (snapshot.runLane !== targetLane) {
      visualX = interpolatedX(nowBN);
      transitionFrom = visualX;
      transitionStartedAt = nowBN;
      targetLane = snapshot.runLane;
    }
    visualX = interpolatedX(nowBN);
  }

  function interpolatedX(nowBN) {
    const targetX = targetLane - 1;
    const progress = Math.min(1, Math.max(0, (nowBN - transitionStartedAt) / cfg.LaneTransitionMS));
    const eased = 1 - (1 - progress) ** 3;
    return transitionFrom + (targetX - transitionFrom) * eased;
  }

  function renderRoad(snapshot) {
    const visibleObjects = [];
    for (let index = snapshot.runRoadIndex; index < road.length; index += 1) {
      const station = road[index];
      const relative = station.at - snapshot.runDistance;
      if (relative > cfg.ViewDistance) break;
      for (let lane = 0; lane < 3; lane += 1) {
        const key = station.lanes[lane];
        if (key !== null) visibleObjects.push({ key, lane, relative });
      }
    }
    visibleObjects.sort((left, right) => right.relative - left.relative || left.lane - right.lane);
    for (let index = 0; index < pool.length; index += 1) {
      const node = pool[index];
      const item = visibleObjects[index];
      if (!item) {
        node.hidden = true;
        continue;
      }
      const symbolID = SYMBOL_IDS[objects[item.key].svg];
      const position = project(item.lane, item.relative);
      node.hidden = false;
      node.setAttribute("href", `#${symbolID}`);
      node.setAttribute("transform", `translate(${position.x} ${position.y}) scale(${position.scale})`);
    }
  }

  function schedule() {
    if (destroyed || !visible || renderTimer !== null) return;
    renderTimer = setTimeout(render, cfg.RenderWaitMS);
  }

  render();

  return Object.freeze({
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      if (!visible && renderTimer !== null) {
        clearTimeout(renderTimer);
        renderTimer = null;
      } else if (visible) {
        render();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (renderTimer !== null) clearTimeout(renderTimer);
      renderTimer = null;
    },
  });
}

function project(lane, relative) {
  const t = 1 - Math.min(1, Math.max(0, relative / cfg.ViewDistance));
  const depth = t ** 1.35;
  const y = 154 + depth * 486;
  const laneOffset = (lane - 1) * (46 + depth * 138);
  return { x: 300 + laneOffset, y, scale: 0.22 + depth * 0.78 };
}
