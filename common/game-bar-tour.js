import { getPreference, setPreference } from "./storage.js";

export const GAME_BAR_TOUR_VERSION = "3";

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
  let destroyed = false;

  const tour = document.createElement("section");
  tour.className = "game-bar-tour";
  tour.dataset.gameBarTour = "";
  tour.setAttribute("role", "dialog");
  tour.setAttribute("aria-labelledby", "game-bar-tour-title");
  tour.innerHTML = `
    <h2 class="game-bar-tour-heading" id="game-bar-tour-title" data-game-bar-tour-title></h2>
    <div class="game-bar-tour-callouts"></div>
    <div class="game-bar-tour-actions">
      <button type="button" class="game-bar-tour-done" data-game-bar-tour-done></button>
    </div>
  `;
  page.append(tour);
  gameBar.dataset.tourActive = "true";
  targets.forEach((target, index) => {
    target.classList.add("game-bar-tour-target");
    target.dataset.gameBarTourNumber = String(index + 1);
  });

  const done = tour.querySelector("[data-game-bar-tour-done]");
  const blockGameBar = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  gameBar.addEventListener("click", blockGameBar, true);
  gameBar.addEventListener("keydown", blockGameBar, true);
  done.addEventListener("click", () => {
    setPreference("gameBarTour", GAME_BAR_TOUR_VERSION);
    destroy();
    requestAnimationFrame(() => gameButton.focus({ preventScroll: true }));
  });
  render();
  requestAnimationFrame(() => done.focus({ preventScroll: true }));

  function render() {
    if (destroyed) return;
    tour.querySelector("[data-game-bar-tour-title]").textContent = activeStrings.gameBarTourTitle;
    tour.querySelector(".game-bar-tour-callouts").innerHTML = activeStrings.gameBarTourSteps.map((copy, index) => `
      <article class="game-bar-tour-callout" data-game-bar-tour-callout="${index}">
        <h3><span class="game-bar-tour-number">${index + 1}</span>${escapeHTML(activeStrings.gameBarTourLabels[index])}</h3>
        <p>${escapeHTML(copy)}</p>
      </article>
    `).join("");
    done.textContent = activeStrings.gameBarTourDone;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    targets.forEach((target) => {
      target.classList.remove("game-bar-tour-target");
      delete target.dataset.gameBarTourNumber;
    });
    delete gameBar.dataset.tourActive;
    gameBar.removeEventListener("click", blockGameBar, true);
    gameBar.removeEventListener("keydown", blockGameBar, true);
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

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function inactiveBinding() {
  return Object.freeze({ active: false, setLanguage() {}, destroy() {} });
}
