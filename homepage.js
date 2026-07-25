import { LANG } from "./lang.js";
import { renderHeader, escapeHTML } from "./common/header.js";
import { iconMarkup } from "./common/icons.js";
import { MAX_CHALLENGE_MEMO_LENGTH, loadChallenges, saveChallenges } from "./common/storage.js";
import { renderQr } from "./common/qr.js";
import { createChallengeEntry, formatTime } from "./common/challenges.js";
import { buildChallengeSharePayload, copyText, shareContent } from "./common/share.js";
import { closeActiveModal, openModal } from "./common/modal.js";

let selectedKey = null;
const renderStates = new WeakMap();
const HOME_STEP_STATE_KEY = "zubenHomeStep";
const HOME_STEPS = new Set(["create", "share"]);

export async function renderHomepage(mount, context) {
  const previous = renderStates.get(mount);
  previous?.cleanup();
  closeActiveModal({ restoreFocus: false });
  const stateToken = { cleanup: () => {} };
  renderStates.set(mount, stateToken);
  mount.replaceChildren();
  const rerender = () => renderHomepage(mount, context);
  const headerState = renderHeader(mount, {
    version: context.version,
    onModeChange: rerender,
    onLanguageChange: rerender,
  });
  stateToken.cleanup = headerState.cleanup;
  const { language, strings, mode } = headerState;
  const newStep = readNewStep();
  const gameText = await loadGameText(context.gameList, language);
  if (renderStates.get(mount) !== stateToken || !mount.isConnected) return;
  const challenges = loadChallenges().sort((a, b) => b.createdAt - a.createdAt);
  if (!selectedKey && challenges.length) selectedKey = challengeKey(challenges[0]);
  if (selectedKey && !challenges.some((entry) => challengeKey(entry) === selectedKey)) {
    selectedKey = challenges[0] ? challengeKey(challenges[0]) : null;
  }

  const main = document.createElement("main");
  main.className = `homepage homepage-${mode}`;
  mount.append(main);

  if (mode === "new") {
    renderNewMode(main, { ...context, strings, language, gameText, challenges, newStep, rerender });
  } else {
    renderProMode(main, { ...context, strings, language, gameText, challenges, rerender });
  }
}

export function disposeHomepage(mount) {
  const state = renderStates.get(mount);
  if (!state) return;
  renderStates.delete(mount);
  state.cleanup();
  closeActiveModal({ restoreFocus: false });
}

function renderNewMode(main, state) {
  if (state.newStep === "menu") {
    const menu = document.createElement("section");
    menu.className = "new-menu";
    menu.innerHTML = `
      ${menuButton("publish", state.strings.newPublish, state.strings.newPublishHint, "share")}
      ${menuButton("create", state.strings.newCreate, state.strings.newCreateHint, "create-list")}
    `;
    menu.querySelector('[data-action="publish"]').addEventListener("click", () => navigateNewStep("share", state));
    menu.querySelector('[data-action="create"]').addEventListener("click", () => navigateNewStep("create", state));
    main.append(menu);
    return;
  }

  const nav = sectionNav(state.strings, () => history.back());
  main.append(nav);
  if (state.newStep === "create") {
    main.append(renderGameList(state));
    return;
  }
  main.append(renderShareArea(state));
  main.append(renderChallengeList(state, false));
}

function renderProMode(main, state) {
  main.append(renderShareArea(state));
  main.append(renderChallengeList(state, true));
  main.append(renderGameList(state));
}

function renderShareArea(state) {
  const section = document.createElement("section");
  section.className = "panel share-panel";
  const selected = state.challenges.find((entry) => challengeKey(entry) === selectedKey) ?? null;
  section.innerHTML = `<h1 class="section-title">${state.strings.shareChallenge}</h1>`;

  if (!selected) {
    section.insertAdjacentHTML("beforeend", `<div class="empty-state">${state.strings.noChallenges}</div>`);
    return section;
  }

  const { url } = challengeSharePayload(selected, state);
  const shortTime = formatTime(selected.createdAt, state.language, "short");
  section.insertAdjacentHTML("beforeend", `
    <div class="share-grid">
      <button class="qr-box" type="button" title="${escapeHTML(url)}"></button>
      <div class="share-details">
        <div class="code-row">
          <div class="code-line"><code>${escapeHTML(selected.iCode)}</code><time>${escapeHTML(shortTime)}</time></div>
          <a class="play-launch" data-play-challenge href="${escapeHTML(url)}" target="_blank" rel="noopener" aria-label="${state.strings.openGameNewTab}">${iconMarkup("gamepad", "play-icon")}</a>
        </div>
        <input class="memo-input" maxlength="${MAX_CHALLENGE_MEMO_LENGTH}" aria-label="${state.strings.memo}" value="${escapeHTML(selected.memo)}">
      </div>
      <button class="share-launch" type="button" aria-label="${state.strings.share}">${iconMarkup("share", "share-icon")}<strong>${state.strings.share}</strong></button>
    </div>
  `);

  const qrButton = section.querySelector(".qr-box");
  const hasQr = renderQr(qrButton, url, {
    label: state.strings.challengeQr,
    fallbackText: state.strings.qrUnavailable,
  });
  qrButton.setAttribute("aria-label", hasQr ? state.strings.enlargeChallengeQr : state.strings.challengeLinkActions);

  const memo = section.querySelector(".memo-input");
  memo.addEventListener("change", () => {
    const entries = loadChallenges();
    const item = entries.find((entry) => challengeKey(entry) === selectedKey);
    if (item) item.memo = memo.value.trim();
    saveChallenges(entries);
    state.rerender();
  });
  section.querySelector(".share-launch").addEventListener("click", () => shareChallenge(selected, state));
  qrButton.addEventListener("click", () => openChallengeQr(url, state));
  return section;
}

function openChallengeQr(url, state) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop challenge-qr-backdrop";
  backdrop.innerHTML = `
    <section class="modal-card challenge-qr-dialog" role="dialog" aria-labelledby="challenge-qr-title">
      <h2 id="challenge-qr-title">${state.strings.challengeQrTitle}</h2>
      <div class="challenge-qr-large"></div>
      <div class="modal-actions challenge-qr-actions">
        <button class="action-button cancel" type="button">${state.strings.cancel}</button>
        <button class="action-button" data-copy-link type="button">${state.strings.copyLink}</button>
        <a class="action-button primary" data-open-game href="${escapeHTML(url)}" target="_blank" rel="noopener">${state.strings.openGameNewTab}</a>
      </div>
    </section>
  `;
  renderQr(backdrop.querySelector(".challenge-qr-large"), url, {
    label: state.strings.challengeQr,
    fallbackText: state.strings.qrUnavailable,
  });
  const modal = openModal(backdrop, { initialFocus: backdrop.querySelector("[data-open-game]"), returnFocus: document.querySelector(".qr-box") });
  backdrop.querySelector(".cancel").addEventListener("click", () => modal.close(), { signal: modal.signal });
  backdrop.querySelector("[data-copy-link]").addEventListener("click", () => copyText(url, state.strings), { signal: modal.signal });
}

function renderChallengeList(state, compact) {
  const section = document.createElement("section");
  section.className = compact ? "challenge-bar" : "challenge-section";

  if (!state.challenges.length) {
    section.innerHTML = `<div class="empty-state">${state.strings.noChallenges}</div>`;
    return section;
  }

  const list = document.createElement("div");
  list.className = compact ? "challenge-strip" : "challenge-list";
  for (const entry of state.challenges) {
    const game = state.gameList.find((item) => item.gameID === entry.gameID);
    if (!game) continue;
    const card = compact
      ? compactChallengeCard(entry, state)
      : fullChallengeCard(entry, state);
    const key = challengeKey(entry);
    card.classList.toggle("selected", key === selectedKey);
    card.addEventListener("click", () => { selectedKey = key; state.rerender(); });

    if (compact) attachLongPress(card, () => confirmDelete(entry, state));
    else card.querySelector(".delete-button").addEventListener("click", (event) => {
      event.stopPropagation();
      confirmDelete(entry, state);
    });
    list.append(card);
  }
  section.append(list);
  return section;
}

function renderGameList(state) {
  const section = document.createElement("section");
  section.className = "game-section";
  section.innerHTML = `<h1 class="section-title">${state.strings.chooseGame}</h1>`;
  const list = document.createElement("div");
  list.className = "game-list";

  for (const game of state.gameList) {
    const text = state.gameText[game.gameID];
    const card = document.createElement("article");
    card.className = "game-card";
    card.innerHTML = `
      ${iconMarkup(game.gameID, "game-icon")}
      <div class="game-copy"><h2>${escapeHTML(text.name)}</h2><p>${escapeHTML(text.description)}</p></div>
      <div class="duration-buttons">
        ${game.durs.map((duration, durIdx) => `<button type="button" data-dur-idx="${durIdx}">${duration}</button>`).join("")}
      </div>
    `;
    card.querySelectorAll("[data-dur-idx]").forEach((button) => button.addEventListener("click", () => {
      const durIdx = Number(button.dataset.durIdx);
      createChallenge(game, durIdx, state);
    }));
    list.append(card);
  }
  section.append(list);
  return section;
}

function createChallenge(game, durIdx, state) {
  const duration = game.durs[durIdx];
  if (!duration) return;
  const entry = createChallengeEntry({ gameID: game.gameID, durIdx, duration, language: state.language });
  const entries = loadChallenges();
  entries.unshift(entry);
  saveChallenges(entries);
  selectedKey = challengeKey(entry);
  navigateNewStep("share", state);
}

function readNewStep() {
  const step = history.state?.[HOME_STEP_STATE_KEY];
  return HOME_STEPS.has(step) ? step : "menu";
}

function navigateNewStep(step, state) {
  if (!HOME_STEPS.has(step) || readNewStep() === step) return;
  const currentState = history.state && typeof history.state === "object" ? history.state : {};
  history.pushState({ ...currentState, [HOME_STEP_STATE_KEY]: step }, "", location.href);
  state.rerender();
}

function fullChallengeCard(entry, state) {
  const card = document.createElement("article");
  card.className = "challenge-card";
  const text = state.gameText[entry.gameID];
  card.innerHTML = `
    <div class="marked-icon">${iconMarkup(entry.gameID, "game-icon")}<b>${entry.durationMark}</b></div>
    <div class="game-copy"><h2>${escapeHTML(text.name)} <time>${escapeHTML(formatTime(entry.createdAt, state.language, "short"))}</time></h2><p>${escapeHTML(entry.memo)}</p></div>
    <div class="challenge-controls">
      <span class="challenge-score"><span class="visually-hidden">${state.strings.bestScore}: ${entry.bestScore}</span><span aria-hidden="true">${entry.bestScore}</span></span>
      <button class="delete-button" type="button" aria-label="${state.strings.delete}">${iconMarkup("trash", "delete-icon")}</button>
    </div>
  `;
  return card;
}

function compactChallengeCard(entry, state) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "compact-challenge";
  card.innerHTML = `
    <span class="marked-icon">${iconMarkup(entry.gameID, "compact-game-icon")}<b>${entry.durationMark}</b></span>
    <code>${escapeHTML(entry.iCode.slice(-4))}</code>
    <strong class="compact-score" aria-hidden="true">${entry.bestScore}</strong>
    <small>${escapeHTML(entry.memo)}</small>
  `;
  card.setAttribute("aria-label", `${state.gameText[entry.gameID].name}, ${entry.iCode.slice(-4)}, ${state.strings.bestScore}: ${entry.bestScore}, ${entry.memo}`);
  return card;
}

function confirmDelete(entry, state) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" role="dialog" aria-labelledby="delete-dialog-title">
      <h2 id="delete-dialog-title">🗑 ${state.strings.deleteTitle}</h2>
      <p class="disclaimer">${state.strings.deleteBody}</p>
      <div class="modal-actions">
        <button class="action-button cancel" type="button">${state.strings.cancel}</button>
        <button class="action-button danger confirm" type="button">${state.strings.delete}</button>
      </div>
    </div>
  `;
  const modal = openModal(backdrop, { initialFocus: backdrop.querySelector(".cancel") });
  backdrop.querySelector(".cancel").addEventListener("click", () => modal.close(), { signal: modal.signal });
  backdrop.querySelector(".confirm").addEventListener("click", () => {
    const entries = loadChallenges().filter((item) => challengeKey(item) !== challengeKey(entry));
    saveChallenges(entries);
    if (selectedKey === challengeKey(entry)) selectedKey = entries[0] ? challengeKey(entries[0]) : null;
    modal.close({ restoreFocus: false });
    state.rerender();
  }, { signal: modal.signal });
}

function attachLongPress(element, callback) {
  let timer = null;
  let origin = null;
  const cancel = () => { clearTimeout(timer); timer = null; origin = null; };
  element.addEventListener("pointerdown", (event) => {
    origin = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => { timer = null; callback(); }, 560);
  });
  element.addEventListener("pointermove", (event) => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 9) cancel();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((name) => element.addEventListener(name, cancel));
  element.addEventListener("contextmenu", (event) => { event.preventDefault(); cancel(); callback(); });
  element.addEventListener("keydown", (event) => { if (event.key === "Delete") callback(); });
}

async function shareChallenge(entry, state) {
  const payload = challengeSharePayload(entry, state);
  await shareContent({ ...payload, strings: state.strings });
}

function challengeSharePayload(entry, state) {
  const gameIdx = state.gameList.findIndex((item) => item.gameID === entry.gameID);
  if (gameIdx < 0) throw new Error(`Unknown gameID: ${entry.gameID}`);
  return buildChallengeSharePayload({
    nickname: document.querySelector(".nickname-button")?.textContent?.trim() || "Player",
    score: entry.bestScore,
    gameIdx,
    gameID: entry.gameID,
    gameDisplayName: state.gameText[entry.gameID].name,
    iCode: entry.iCode,
    strings: state.strings,
  });
}

function challengeKey(entry) { return `${entry.gameID}:${entry.iCode}`; }

async function loadGameText(gameList, language) {
  const pairs = await Promise.all(gameList.map(async (game) => {
    const module = await import(`./${game.gameID}/lang.js`);
    return [game.gameID, module.GAME_LANG[language] ?? module.GAME_LANG.en];
  }));
  return Object.fromEntries(pairs);
}

function menuButton(action, title, hint, iconID) {
  return `<button class="new-menu-button" type="button" data-action="${action}"><span class="menu-mark">${iconMarkup(iconID, "menu-icon")}</span><span><strong>${title}</strong><small>${hint}</small></span></button>`;
}

function sectionNav(strings, callback) {
  const nav = document.createElement("nav");
  nav.className = "section-nav";
  nav.innerHTML = `<button type="button">←</button>`;
  nav.querySelector("button").addEventListener("click", callback);
  return nav;
}
