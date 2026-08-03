import { getPreference, setPreference } from "./storage.js";

export const GAME_BAR_TOUR_VERSION = "1";

const TOUR_STEP_SELECTORS = Object.freeze([
  ".time-metric",
  ".game-button",
  ".score-metric",
  "[data-tug]",
  ".ghost-metric",
  "[data-game-bar-charge]",
]);

export function createGameBarTour(page, strings) {
  if (!page?.querySelector || getPreference("gameBarTour", "") === GAME_BAR_TOUR_VERSION) {
    return inactiveBinding();
  }

  const gameBar = page.querySelector(".game-bar");
  const gameButton = page.querySelector(".game-button");
  const targets = TOUR_STEP_SELECTORS.map((selector) => page.querySelector(selector));
  if (!gameBar || !gameButton || targets.some((target) => !target)) return inactiveBinding();

  let activeStrings = strings;
  let stepIndex = 0;
  let activeTarget = null;
  let destroyed = false;

  const tour = document.createElement("section");
  tour.className = "game-bar-tour";
  tour.dataset.gameBarTour = "";
  tour.setAttribute("role", "dialog");
  tour.setAttribute("aria-labelledby", "game-bar-tour-title");
  tour.innerHTML = `
    <div class="game-bar-tour-heading">
      <strong id="game-bar-tour-title" data-game-bar-tour-title></strong>
      <span data-game-bar-tour-count></span>
    </div>
    <p data-game-bar-tour-copy></p>
    <div class="game-bar-tour-actions">
      <button type="button" data-game-bar-tour-back></button>
      <button type="button" class="game-bar-tour-next" data-game-bar-tour-next></button>
    </div>
  `;
  page.append(tour);
  gameBar.dataset.tourActive = "true";

  const back = tour.querySelector("[data-game-bar-tour-back]");
  const next = tour.querySelector("[data-game-bar-tour-next]");
  const blockGameBar = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  gameBar.addEventListener("click", blockGameBar, true);
  gameBar.addEventListener("keydown", blockGameBar, true);
  back.addEventListener("click", () => {
    if (stepIndex > 0) {
      stepIndex -= 1;
      render();
    }
  });
  next.addEventListener("click", () => {
    if (stepIndex < targets.length - 1) {
      stepIndex += 1;
      render();
      return;
    }
    setPreference("gameBarTour", GAME_BAR_TOUR_VERSION);
    destroy();
    requestAnimationFrame(() => gameButton.focus({ preventScroll: true }));
  });
  addEventListener("resize", position);
  render();
  requestAnimationFrame(() => next.focus({ preventScroll: true }));

  function render() {
    if (destroyed) return;
    activeTarget?.classList.remove("game-bar-tour-target");
    activeTarget = targets[stepIndex];
    activeTarget.classList.add("game-bar-tour-target");
    tour.querySelector("[data-game-bar-tour-title]").textContent = activeStrings.gameBarTourTitle;
    tour.querySelector("[data-game-bar-tour-count]").textContent = `${stepIndex + 1}/${targets.length}`;
    tour.querySelector("[data-game-bar-tour-copy]").textContent = activeStrings.gameBarTourSteps[stepIndex];
    back.textContent = activeStrings.gameBarTourBack;
    back.hidden = stepIndex === 0;
    next.textContent = stepIndex === targets.length - 1
      ? activeStrings.gameBarTourDone
      : activeStrings.gameBarTourNext;
    position();
  }

  function position() {
    if (destroyed || !tour.isConnected || !activeTarget) return;
    const pageRect = page.getBoundingClientRect();
    const barRect = gameBar.getBoundingClientRect();
    const targetRect = activeTarget.getBoundingClientRect();
    const tourRect = tour.getBoundingClientRect();
    const margin = 8;
    const targetCenter = targetRect.left + targetRect.width / 2 - pageRect.left;
    const left = Math.min(
      pageRect.width - tourRect.width - margin,
      Math.max(margin, targetCenter - tourRect.width / 2),
    );
    tour.style.left = `${left}px`;
    tour.style.top = `${barRect.bottom - pageRect.top + 8}px`;
    tour.style.setProperty("--game-bar-tour-arrow-x", `${targetCenter - left}px`);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    activeTarget?.classList.remove("game-bar-tour-target");
    delete gameBar.dataset.tourActive;
    gameBar.removeEventListener("click", blockGameBar, true);
    gameBar.removeEventListener("keydown", blockGameBar, true);
    removeEventListener("resize", position);
    tour.remove();
  }

  return {
    active: true,
    setLanguage(nextStrings) {
      activeStrings = nextStrings;
      render();
    },
    destroy,
  };
}

function inactiveBinding() {
  return Object.freeze({ active: false, setLanguage() {}, destroy() {} });
}
