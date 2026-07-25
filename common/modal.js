let activeModal = null;

export function openModal(backdrop, { initialFocus, returnFocus = document.activeElement, closeOnBackdrop = true } = {}) {
  closeActiveModal({ restoreFocus: false });
  const dialog = backdrop.querySelector('[role="dialog"]');
  if (!dialog) throw new Error("Modal backdrop must contain a dialog");
  dialog.setAttribute("aria-modal", "true");
  const controller = new AbortController();
  let closed = false;

  const close = ({ restoreFocus = true } = {}) => {
    if (closed) return;
    closed = true;
    controller.abort();
    backdrop.remove();
    if (activeModal?.backdrop === backdrop) activeModal = null;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  };

  backdrop.addEventListener("pointerdown", (event) => {
    if (closeOnBackdrop && event.target === backdrop) close();
  }, { signal: controller.signal });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = getFocusable(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, { signal: controller.signal });

  document.body.append(backdrop);
  activeModal = { backdrop, close };
  const target = initialFocus ?? getFocusable(dialog)[0] ?? dialog;
  if (!target.hasAttribute("tabindex") && target === dialog) target.tabIndex = -1;
  target.focus();
  return Object.freeze({ close, signal: controller.signal });
}

export function closeActiveModal(options) {
  activeModal?.close(options);
}

function getFocusable(container) {
  return [...container.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}
