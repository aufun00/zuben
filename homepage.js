import { renderHeader, escapeHTML } from "./common/header.js";
import { iconMarkup } from "./common/icons.js";
import { loadChallenges, saveChallenges } from "./common/storage.js";
import { createChallengeEntry, formatTime } from "./common/challenges.js";
import { openChallengeShareDialog } from "./common/share-dialog.js";
import { closeActiveModal, openModal } from "./common/modal.js";

const HOME_TAB_STATE_KEY = "zubenHomeTab";
const HOME_TABS = new Set(["challenges", "games"]);
const renderStates = new WeakMap();
let pendingChallengeKey = null;

export async function renderHomepage(mount, context) {
  const previous = renderStates.get(mount);
  previous?.cleanup();
  closeActiveModal({ restoreFocus: false });
  const stateToken = { cleanup: () => {} };
  renderStates.set(mount, stateToken);
  mount.replaceChildren();
  const rerender = () => renderHomepage(mount, context);
  const headerState = renderHeader(mount, { version: context.version, onLanguageChange: rerender });
  stateToken.cleanup = headerState.cleanup;
  const { language, strings } = headerState;
  const gameText = await loadGameText(context.gameList, language);
  if (renderStates.get(mount) !== stateToken || !mount.isConnected) return;

  const challenges = loadChallenges();
  const activeTab = readHomeTab(challenges);
  const state = { ...context, strings, language, gameText, challenges, activeTab, rerender };
  const main = document.createElement("main");
  main.className = "homepage";
  main.append(renderTabs(state));
  const panel = document.createElement("section");
  panel.className = "home-tab-panel";
  panel.id = `home-panel-${activeTab}`;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `home-tab-${activeTab}`);
  panel.append(activeTab === "challenges" ? renderChallengeList(state) : renderGameList(state));
  main.append(panel);
  mount.append(main);

  if (pendingChallengeKey) {
    const key = pendingChallengeKey;
    pendingChallengeKey = null;
    const entry = challenges.find((item) => challengeKey(item) === key);
    const button = main.querySelector(`[data-challenge-key="${CSS.escape(key)}"] .challenge-open`);
    if (entry && button) openChallengeDialog(entry, state, button);
  }
}

export function disposeHomepage(mount) {
  const state = renderStates.get(mount);
  if (!state) return;
  renderStates.delete(mount);
  state.cleanup();
  closeActiveModal({ restoreFocus: false });
}

function renderTabs(state) {
  const tabs = document.createElement("div");
  tabs.className = "home-tabs";
  tabs.setAttribute("role", "tablist");
  for (const tab of ["challenges", "games"]) {
    const button = document.createElement("button");
    button.id = `home-tab-${tab}`;
    button.type = "button";
    button.role = "tab";
    button.dataset.homeTab = tab;
    button.setAttribute("aria-controls", `home-panel-${tab}`);
    button.setAttribute("aria-selected", String(tab === state.activeTab));
    button.tabIndex = tab === state.activeTab ? 0 : -1;
    button.textContent = tab === "challenges" ? state.strings.challengesTab : state.strings.gamesTab;
    button.addEventListener("click", () => navigateHomeTab(tab, state));
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const next = tab === "challenges" ? "games" : "challenges";
      navigateHomeTab(next, state, true);
    });
    tabs.append(button);
  }
  return tabs;
}

function renderChallengeList(state) {
  const section = document.createElement("div");
  section.className = "challenge-section";
  if (!state.challenges.length) {
    section.innerHTML = `<div class="empty-state"><p>${escapeHTML(state.strings.noChallenges)}</p><button class="action-button primary" type="button">${escapeHTML(state.strings.createChallenge)}</button></div>`;
    section.querySelector("button").addEventListener("click", () => navigateHomeTab("games", state));
    return section;
  }

  const list = document.createElement("div");
  list.className = "challenge-list";
  for (const entry of state.challenges) {
    const game = state.gameList.find((item) => item.gameID === entry.gameID);
    if (!game) continue;
    const card = document.createElement("article");
    card.className = "challenge-card";
    card.dataset.challengeKey = challengeKey(entry);
    const text = state.gameText[entry.gameID];
    card.innerHTML = `
      <button class="challenge-open" type="button">
        <span class="marked-icon">${iconMarkup(entry.gameID, "game-icon")}<b>${entry.durationMark}</b></span>
        <span class="game-copy"><strong>${escapeHTML(text.name)} <time>${escapeHTML(formatTime(entry.createdAt, state.language, "short"))}</time></strong><small>${escapeHTML(entry.memo)}</small></span>
        <span class="challenge-score"><span class="visually-hidden">${escapeHTML(state.strings.bestScore)}: ${entry.bestScore}</span><span aria-hidden="true">${entry.bestScore}</span></span>
      </button>
      <button class="delete-button" type="button" aria-label="${escapeHTML(state.strings.delete)}">${iconMarkup("trash", "delete-icon")}</button>
    `;
    const openButton = card.querySelector(".challenge-open");
    openButton.addEventListener("click", () => openChallengeDialog(entry, state, openButton));
    card.querySelector(".delete-button").addEventListener("click", () => confirmDelete(entry, state));
    list.append(card);
  }
  section.append(list);
  return section;
}

function renderGameList(state) {
  const section = document.createElement("div");
  section.className = "game-section";
  section.innerHTML = `<h1 class="section-title">${escapeHTML(state.strings.chooseGame)}</h1>`;
  const list = document.createElement("div");
  list.className = "game-list";
  for (const game of state.gameList) {
    const text = state.gameText[game.gameID];
    const card = document.createElement("article");
    card.className = "game-card";
    card.innerHTML = `
      ${iconMarkup(game.gameID, "game-icon")}
      <div class="game-copy"><h2>${escapeHTML(text.name)}</h2><p>${escapeHTML(text.description)}</p></div>
      <div class="duration-buttons">${game.durs.map((duration, durIdx) => `<button type="button" data-dur-idx="${durIdx}">${duration}</button>`).join("")}</div>
    `;
    card.querySelectorAll("[data-dur-idx]").forEach((button) => button.addEventListener("click", () => createChallenge(game, Number(button.dataset.durIdx), state)));
    list.append(card);
  }
  section.append(list);
  return section;
}

function createChallenge(game, durIdx, state) {
  const duration = game.durs[durIdx];
  if (!duration) return;
  const entry = createChallengeEntry({ gameID: game.gameID, durIdx, duration, language: state.language });
  saveChallenges([entry, ...loadChallenges()]);
  pendingChallengeKey = challengeKey(entry);
  navigateHomeTab("challenges", state);
}

function openChallengeDialog(entry, state, returnFocus) {
  const gameIdx = state.gameList.findIndex((item) => item.gameID === entry.gameID);
  if (gameIdx < 0) return;
  openChallengeShareDialog({
    challenge: { ...entry, score: entry.bestScore },
    gameIdx,
    gameDisplayName: state.gameText[entry.gameID].name,
    nickname: document.querySelector(".nickname-button")?.textContent?.trim() || state.strings.nickname,
    language: state.language,
    strings: state.strings,
    returnFocus,
    onMemoChange(value) {
      const entries = loadChallenges();
      const item = entries.find((candidate) => challengeKey(candidate) === challengeKey(entry));
      if (!item) return;
      item.memo = value;
      const saved = saveChallenges(entries);
      const persisted = saved.find((candidate) => challengeKey(candidate) === challengeKey(entry));
      if (!persisted) return;
      entry.memo = persisted.memo;
      returnFocus.closest(".challenge-card")?.querySelector(".game-copy small")?.replaceChildren(persisted.memo);
      return persisted.memo;
    },
  });
}

function confirmDelete(entry, state) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card" role="dialog" aria-labelledby="delete-dialog-title">
      <h2 id="delete-dialog-title">🗑 ${escapeHTML(state.strings.deleteTitle)}</h2>
      <p class="disclaimer">${escapeHTML(state.strings.deleteBody)}</p>
      <div class="modal-actions">
        <button class="action-button cancel" type="button">${escapeHTML(state.strings.cancel)}</button>
        <button class="action-button danger confirm" type="button">${escapeHTML(state.strings.delete)}</button>
      </div>
    </div>
  `;
  const modal = openModal(backdrop, { initialFocus: backdrop.querySelector(".cancel") });
  backdrop.querySelector(".cancel").addEventListener("click", () => modal.close(), { signal: modal.signal });
  backdrop.querySelector(".confirm").addEventListener("click", () => {
    saveChallenges(loadChallenges().filter((item) => challengeKey(item) !== challengeKey(entry)));
    modal.close({ restoreFocus: false });
    state.rerender();
  }, { signal: modal.signal });
}

function readHomeTab(challenges) {
  const tab = history.state?.[HOME_TAB_STATE_KEY];
  return HOME_TABS.has(tab) ? tab : challenges.length ? "challenges" : "games";
}

function navigateHomeTab(tab, state, focus = false) {
  if (!HOME_TABS.has(tab) || tab === state.activeTab) return;
  const currentState = history.state && typeof history.state === "object" ? history.state : {};
  history.pushState({ ...currentState, [HOME_TAB_STATE_KEY]: tab }, "", location.href);
  state.rerender().then(() => { if (focus) document.querySelector(`[data-home-tab="${tab}"]`)?.focus(); });
}

function challengeKey(entry) { return `${entry.gameID}:${entry.iCode}`; }

async function loadGameText(gameList, language) {
  const pairs = await Promise.all(gameList.map(async (game) => {
    const module = await import(`./${game.gameID}/lang.js`);
    return [game.gameID, module.GAME_LANG[language] ?? module.GAME_LANG.en];
  }));
  return Object.fromEntries(pairs);
}
