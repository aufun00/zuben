const DIRECTION_SYMBOLS = Object.freeze({ up: "↑", right: "→", down: "↓", left: "←" });

export function bindGestureInput(element, { begin, commit, thresholdPx = 28 }) {
  const controller = new AbortController();
  let session = null;
  let arrows = null;

  element.classList.add("gesture-surface");
  element.addEventListener("pointerdown", (event) => {
    if (session || !event.isPrimary || event.button !== 0) return;
    const descriptor = begin(event);
    if (!descriptor) return;
    if (descriptor.downAction !== undefined) {
      commit(descriptor.downAction, { kind: "down", event });
      return;
    }
    session = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      descriptor,
      candidate: null,
    };
    try { element.setPointerCapture(event.pointerId); } catch {}
    showArrows(event, descriptor.directions ?? {});
  }, { signal: controller.signal });

  element.addEventListener("pointermove", (event) => {
    if (!session || event.pointerId !== session.pointerId) return;
    event.preventDefault();
    const direction = getGestureDirection(event.clientX - session.startX, event.clientY - session.startY, thresholdPx / 2);
    session.candidate = direction && session.descriptor.directions?.[direction] !== undefined ? direction : null;
    paintCandidate(session.candidate);
  }, { signal: controller.signal });

  element.addEventListener("pointerup", (event) => finish(event, false), { signal: controller.signal });
  element.addEventListener("pointercancel", (event) => finish(event, true), { signal: controller.signal });
  element.addEventListener("click", (event) => {
    if (event.detail !== 0) return;
    const descriptor = begin(event);
    if (!descriptor) return;
    const action = descriptor.downAction ?? descriptor.tapAction;
    if (action !== undefined) commit(action, { kind: descriptor.downAction !== undefined ? "down" : "tap", event });
  }, { signal: controller.signal });

  function finish(event, cancelled) {
    if (!session || event.pointerId !== session.pointerId) return;
    const current = session;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const distance = Math.hypot(dx, dy);
    const direction = getGestureDirection(dx, dy, thresholdPx);
    clearSession();
    if (cancelled) return;
    if (direction && current.descriptor.directions?.[direction] !== undefined) {
      commit(current.descriptor.directions[direction], { kind: "swipe", direction, event });
    } else if (distance < thresholdPx && current.descriptor.tapAction !== undefined) {
      commit(current.descriptor.tapAction, { kind: "tap", event });
    }
  }

  function showArrows(event, directions) {
    const keys = Object.keys(directions).filter((direction) => direction in DIRECTION_SYMBOLS);
    if (!keys.length) return;
    const rect = element.getBoundingClientRect();
    arrows = document.createElement("div");
    arrows.className = "gesture-arrows";
    arrows.setAttribute("aria-hidden", "true");
    arrows.style.setProperty("--gesture-x", `${event.clientX - rect.left}px`);
    arrows.style.setProperty("--gesture-y", `${event.clientY - rect.top}px`);
    arrows.innerHTML = keys.map((direction) => `<span data-direction="${direction}">${DIRECTION_SYMBOLS[direction]}</span>`).join("");
    element.append(arrows);
  }

  function paintCandidate(direction) {
    if (!arrows) return;
    arrows.querySelectorAll("[data-direction]").forEach((arrow) => {
      arrow.classList.toggle("candidate", arrow.dataset.direction === direction);
    });
  }

  function clearSession() {
    if (session) {
      try { element.releasePointerCapture(session.pointerId); } catch {}
    }
    session = null;
    arrows?.remove();
    arrows = null;
  }

  return () => {
    clearSession();
    controller.abort();
    element.classList.remove("gesture-surface");
  };
}

export function getGestureDirection(dx, dy, minimumDistance) {
  if (Math.hypot(dx, dy) < minimumDistance) return null;
  if (Math.abs(dx) === Math.abs(dy)) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "down" : "up";
}
