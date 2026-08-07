import { TILE_CATALOG, cfg } from "./config.js";
import { OPERATION_RESOLVE, OPERATION_SWAP, OPERATION_SWAP_BACK, PHASE_RUNNING } from "./runtime.js";

const PIECE_URLS = TILE_CATALOG.map((_, index) => new URL(`./piece-${index + 1}O.svg`, import.meta.url).href);
const MOVE_EASING = "cubic-bezier(.33,1,.68,1)";

export function createMatch3Renderer({ gameZone, runtime, performanceMeter, readBN = () => performance.now() }) {
  const board = gameZone.querySelector("[data-match3-board]");
  const tiles = Array.from({ length: cfg.BoardSize ** 2 }, (_, index) => {
    const node = document.createElement("button");
    const pieceLayers = TILE_CATALOG.map((_, type) =>
      `<image data-piece-layer="${type}" href="${PIECE_URLS[type]}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:none"></image>`).join("");
    node.type = "button"; node.className = "match3-tile"; node.dataset.index = String(index); node.tabIndex = -1;
    node.innerHTML = `<span class="match3-crystal" aria-hidden="true"><svg viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet">${pieceLayers}</svg></span><span class="match3-mystery" aria-hidden="true">?</span>`;
    board.append(node);
    return Object.freeze({ node, pieceLayers: [...node.querySelectorAll("[data-piece-layer]")], mystery: node.querySelector(".match3-mystery") });
  });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let timer = null, visible = !document.hidden, destroyed = false, selected = null, lastAppearance = "", activeMotion = null, animations = [];

  function render() {
    timer = null; if (destroyed || !visible) return;
    const BN = readBN(); if (runtime.shouldYieldRender(BN)) { runtime.wakePump(); schedule(0); return; }
    const snapshot = runtime.snapshot();
    const animated = Boolean(snapshot.phase === PHASE_RUNNING && snapshot.transition && !reducedMotion.matches);
    let types = snapshot.types, effects = snapshot.effects, clearMarks = null, effectCells = null, progress = 1, falling = false;
    if (animated) {
      const transition = snapshot.transition;
      progress = ratio(snapshot.runGT, transition.startGT, transition.endGT);
      if (snapshot.operation === OPERATION_RESOLVE && snapshot.runGT < transition.clearEndGT) {
        types = transition.beforeTypes; effects = transition.beforeEffects; clearMarks = transition.marks; effectCells = transition.effectCells;
        progress = ratio(snapshot.runGT, transition.startGT, transition.clearEndGT);
      } else if (snapshot.operation === OPERATION_RESOLVE) {
        falling = true;
        progress = ratio(snapshot.runGT, transition.clearEndGT, transition.endGT);
      } else if (snapshot.operation === OPERATION_SWAP || snapshot.operation === OPERATION_SWAP_BACK) {
        types = transition.beforeTypes; effects = transition.beforeEffects;
      }
    }
    const clearing = Boolean(clearMarks && progress > .72);
    const appearance = `${types.join(",")}|${effects.join(",")}|${effectCells?.join(",") ?? ""}|${selected}|${clearing}`;
    if (appearance !== lastAppearance) {
      const effectSet = new Set(effectCells ?? []);
      for (let index = 0; index < tiles.length; index += 1) paintAppearance(tiles[index], types[index], effects[index], index, clearMarks, effectSet, clearing);
      lastAppearance = appearance;
    }
    syncMotion(snapshot, animated, falling);
    performanceMeter.recordFrame(readBN()); schedule();
  }

  function paintAppearance(tile, type, effect, index, marks, effectSet, clearing) {
    const catalog = TILE_CATALOG[type], { node, pieceLayers, mystery } = tile;
    node.dataset.type = String(type); node.dataset.effect = String(effect); node.dataset.piece = catalog?.symbol ?? ""; node.hidden = !catalog;
    for (let layer = 0; layer < pieceLayers.length; layer += 1) pieceLayers[layer].style.display = layer === type ? "inline" : "none";
    mystery.hidden = !effect;
    node.classList.toggle("mystery", Boolean(effect));
    node.classList.toggle("selected", index === selected);
    node.classList.toggle("effect-preview", effectSet.has(index));
    node.classList.toggle("clearing", clearing && Boolean(marks?.[index]));
  }

  function syncMotion(snapshot, animated, falling) {
    const transition = snapshot.transition;
    let motion = null;
    if (animated && (snapshot.operation === OPERATION_SWAP || snapshot.operation === OPERATION_SWAP_BACK)) motion = `${snapshot.operation}:${transition.startGT}`;
    else if (animated && snapshot.operation === OPERATION_RESOLVE && falling) motion = `FALL:${transition.startGT}`;
    if (motion === activeMotion) return;
    clearMotion(); activeMotion = motion;
    if (motion === null) return;
    if (snapshot.operation === OPERATION_SWAP || snapshot.operation === OPERATION_SWAP_BACK) {
      const duration = transition.endGT - transition.startGT, elapsed = snapshot.runGT - transition.startGT;
      animateMove(transition.fromIndex, "translate(0%, 0%)", translate(transition.fromIndex, transition.toIndex), duration, elapsed);
      animateMove(transition.toIndex, "translate(0%, 0%)", translate(transition.toIndex, transition.fromIndex), duration, elapsed);
      return;
    }
    const duration = transition.endGT - transition.clearEndGT, elapsed = snapshot.runGT - transition.clearEndGT;
    for (const item of transition.motions) {
      if (item.fromIndex === item.toIndex) continue;
      animateMove(item.toIndex, translate(item.toIndex, item.fromIndex), "translate(0%, 0%)", duration, elapsed);
    }
  }

  function animateMove(index, from, to, duration, elapsed) {
    const node = tiles[index]?.node;
    if (!node || duration <= 0 || typeof node.animate !== "function") return;
    const animation = node.animate([{ transform: from }, { transform: to }], { duration, easing: MOVE_EASING, fill: "both" });
    animation.currentTime = Math.min(duration, Math.max(0, elapsed));
    animations.push(animation);
  }

  function clearMotion() {
    for (const animation of animations) animation.cancel();
    animations = []; activeMotion = null;
  }

  function translate(from, to) {
    const fromColumn = ((from % cfg.BoardSize) + cfg.BoardSize) % cfg.BoardSize;
    const toColumn = ((to % cfg.BoardSize) + cfg.BoardSize) % cfg.BoardSize;
    const x = (toColumn - fromColumn) * 100;
    const y = (Math.floor(to / cfg.BoardSize) - Math.floor(from / cfg.BoardSize)) * 100;
    return `translate(${x}%, ${y}%)`;
  }

  function schedule(delay = cfg.RenderWaitMS) { if (!destroyed && visible && timer === null) timer = setTimeout(render, delay); }
  render();
  return Object.freeze({
    setSelected(index) { selected = index; lastAppearance = ""; },
    setVisible(value) { visible = Boolean(value); if (!visible && timer !== null) { clearTimeout(timer); timer = null; } else if (visible) render(); },
    destroy() { destroyed = true; if (timer !== null) clearTimeout(timer); timer = null; clearMotion(); },
  });
}

function ratio(value, start, end) { return Math.min(1, Math.max(0, (value - start) / (end - start || 1))); }
