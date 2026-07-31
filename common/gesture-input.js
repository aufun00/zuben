const ACTIVE_SURFACES = new WeakSet();
const ACTIVATION_KEYS = new Set([" ", "Enter"]);
const KEY_DIRECTIONS = Object.freeze({
  ArrowUp: "north",
  ArrowRight: "east",
  ArrowDown: "south",
  ArrowLeft: "west",
});
const SWIPE_DIRECTIONS = Object.freeze([
  "east", "south-east", "south", "south-west",
  "west", "north-west", "north", "north-east",
]);
const RECOGNIZERS = new Set(["press", "tap-swipe", "swipe", "axis-swipe", "drag"]);
const SYNTHETIC_CLICK_DEDUPE_MS = 1_000;

export function bindGameInput(element, {
  recognizer,
  resolveContext = () => undefined,
  handle,
  thresholdPx = 28,
  axis = null,
} = {}) {
  if (!RECOGNIZERS.has(recognizer)) throw new TypeError("recognizer must be press, tap-swipe, swipe, axis-swipe, or drag");
  if (typeof resolveContext !== "function") throw new TypeError("resolveContext must be a function");
  if (typeof handle !== "function") throw new TypeError("handle must be a function");
  if (!Number.isFinite(thresholdPx) || thresholdPx <= 0) throw new RangeError("thresholdPx must be positive");
  if (recognizer === "axis-swipe" && axis !== "x" && axis !== "y") throw new TypeError("axis-swipe axis must be x or y");
  if (ACTIVE_SURFACES.has(element)) throw new Error("game input is already bound to this surface");
  ACTIVE_SURFACES.add(element);

  const controller = new AbortController();
  const eventRoot = element.ownerDocument ?? element;
  const windowRoot = element.ownerDocument?.defaultView;
  let destroyed = false;
  let session = null;
  let keyboardActivation = null;

  element.classList.add("gesture-surface");
  element.addEventListener("pointerdown", onPointerDown, { signal: controller.signal });
  eventRoot.addEventListener("pointermove", onPointerMove, { capture: true, signal: controller.signal });
  eventRoot.addEventListener("pointerup", (event) => finishPointer(event, false), { capture: true, signal: controller.signal });
  eventRoot.addEventListener("pointercancel", (event) => finishPointer(event, true), { capture: true, signal: controller.signal });
  element.addEventListener("lostpointercapture", () => cancelSession(), { signal: controller.signal });
  element.addEventListener("keydown", onKeyDown, { signal: controller.signal });
  element.addEventListener("click", onSyntheticClick, { signal: controller.signal });
  windowRoot?.addEventListener("blur", () => cancelSession(), { signal: controller.signal });
  eventRoot.addEventListener?.("visibilitychange", () => {
    if (eventRoot.hidden) cancelSession();
  }, { signal: controller.signal });

  function onPointerDown(event) {
    if (!event.isPrimary || event.button !== 0) return;
    if (session) cancelSession();
    const context = resolveContext(event);
    if (context === null) return;
    if (recognizer === "press") {
      emit("press", { source: "pointer", context, pointerId: event.pointerId });
      return;
    }
    session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      context,
      dragging: false,
      captured: false,
    };
    try {
      element.setPointerCapture(event.pointerId);
      session.captured = true;
    } catch {}
  }

  function onPointerMove(event) {
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    const movement = getMovement(event, session);
    session.lastX = event.clientX;
    session.lastY = event.clientY;
    if (recognizer === "drag") {
      if (!session.dragging && movement.distance >= thresholdPx) {
        session.dragging = true;
        emit("dragStart", pointerFields(event, session, movement));
      } else if (session.dragging) {
        emit("dragMove", pointerFields(event, session, movement));
      }
      return;
    }
    const thresholdDistance = recognizer === "axis-swipe"
      ? Math.abs(axis === "x" ? movement.dx : movement.dy)
      : movement.distance;
    if (thresholdDistance < thresholdPx) return;
    const fields = pointerFields(event, session, movement);
    clearSession();
    emit("swipe", { ...fields, direction: recognizer === "axis-swipe"
      ? getAxisDirection(axis, movement.dx, movement.dy)
      : getSwipeDirection(movement.dx, movement.dy) });
  }

  function finishPointer(event, cancelled) {
    if (!session || event.pointerId !== session.pointerId) return;
    const current = session;
    const movement = getMovement(event, current);
    clearSession();
    if (recognizer === "drag") {
      if (current.dragging) emit(cancelled ? "dragCancel" : "dragEnd", pointerFields(event, current, movement));
      return;
    }
    if (cancelled) return;
    if (recognizer === "swipe") {
      if (movement.distance >= thresholdPx) {
        emit("swipe", { ...pointerFields(event, current, movement), direction: getSwipeDirection(movement.dx, movement.dy) });
      }
      return;
    }
    if (recognizer !== "tap-swipe") return;
    if (movement.distance >= thresholdPx) {
      emit("swipe", { ...pointerFields(event, current, movement), direction: getSwipeDirection(movement.dx, movement.dy) });
    } else {
      emit("tap", pointerFields(event, current, movement));
    }
  }

  function onKeyDown(event) {
    if (ACTIVATION_KEYS.has(event.key) && !event.repeat && recognizer !== "swipe" && recognizer !== "drag") {
      const context = resolveContext(event);
      if (context === null) return;
      event.preventDefault();
      keyboardActivation = { target: event.target, timeStamp: event.timeStamp };
      emit(recognizer === "press" ? "press" : "tap", { source: "keyboard", context });
      return;
    }
    const direction = KEY_DIRECTIONS[event.key];
    if (!direction || recognizer === "press") return;
    if (recognizer === "axis-swipe" && (event.repeat || !directionMatchesAxis(direction, axis))) return;
    const context = resolveContext(event);
    if (context === null) return;
    event.preventDefault();
    emit("direction", { source: "keyboard", context, direction, repeat: Boolean(event.repeat) });
  }

  function onSyntheticClick(event) {
    if (event.detail !== 0 || recognizer === "swipe" || recognizer === "drag") return;
    if (keyboardActivation && keyboardActivation.target === event.target &&
      Math.abs(event.timeStamp - keyboardActivation.timeStamp) <= SYNTHETIC_CLICK_DEDUPE_MS) {
      keyboardActivation = null;
      return;
    }
    const context = resolveContext(event);
    if (context === null) return;
    emit(recognizer === "press" ? "press" : "tap", { source: "synthetic", context });
  }

  function cancelSession() {
    if (!session) return;
    const current = session;
    clearSession();
    if (recognizer === "drag" && current.dragging) {
      const dx = current.lastX - current.startX;
      const dy = current.lastY - current.startY;
      emit("dragCancel", {
        source: "pointer",
        context: current.context,
        pointerId: current.pointerId,
        startX: current.startX,
        startY: current.startY,
        x: current.lastX,
        y: current.lastY,
        dx,
        dy,
        distance: Math.hypot(dx, dy),
      });
    }
  }

  function clearSession() {
    if (!session) return;
    const current = session;
    session = null;
    if (!current.captured) return;
    try { element.releasePointerCapture(current.pointerId); } catch {}
  }

  function emit(type, fields) {
    handle(Object.freeze({ type, ...fields }));
  }

  return Object.freeze({
    cancelSession,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearSession();
      controller.abort();
      ACTIVE_SURFACES.delete(element);
      element.classList.remove("gesture-surface");
    },
  });
}

function getAxisDirection(axis, dx, dy) {
  if (axis === "x" && dx !== 0) return dx < 0 ? "west" : "east";
  if (axis === "y" && dy !== 0) return dy < 0 ? "north" : "south";
  throw new RangeError("axis swipe requires nonzero movement on its axis");
}

function directionMatchesAxis(direction, axis) {
  return axis === "x" ? direction === "west" || direction === "east" : direction === "north" || direction === "south";
}

export function getSwipeDirection(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    throw new RangeError("swipe direction requires a finite nonzero vector");
  }
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return SWIPE_DIRECTIONS[(octant + 8) % 8];
}

function getMovement(event, current) {
  const dx = event.clientX - current.startX;
  const dy = event.clientY - current.startY;
  return { dx, dy, distance: Math.hypot(dx, dy) };
}

function pointerFields(event, current, movement) {
  return {
    source: "pointer",
    context: current.context,
    pointerId: current.pointerId,
    startX: current.startX,
    startY: current.startY,
    x: event.clientX,
    y: event.clientY,
    dx: movement.dx,
    dy: movement.dy,
    distance: movement.distance,
  };
}
