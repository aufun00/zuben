import { LANG } from "./lang.js";
import { generateICode } from "./common/icode.js";
import { renderHeader, getLanguage, getMode, escapeHTML } from "./common/header.js";
import { iconMarkup } from "./common/icons.js";
import { loadChallenges, saveChallenges } from "./common/storage.js";
import { createQrSvg } from "./common/qr.js";

let newStep = "menu";
let selectedKey = null;

export async function renderHomepage(mount, context) {
  mount.replaceChildren();
  const rerender = () => renderHomepage(mount, context);
  const headerState = renderHeader(mount, {
    version: context.version,
    onModeChange: rerender,
    onLanguageChange: rerender,
  });
  const { language, strings, mode } = headerState;
  const gameText = await loadGameText(context.gameList, language);
  const challenges = loadChallenges().sort((a, b) => b.createdAt - a.createdAt);
  if (!selectedKey && challenges.length) selectedKey = challengeKey(challenges[0]);
  if (selectedKey && !challenges.some((entry) => challengeKey(entry) === selectedKey)) {
    selectedKey = challenges[0] ? challengeKey(challenges[0]) : null;
  }

  const main = document.createElement("main");
  main.className = `homepage homepage-${mode}`;
  mount.append(main);

  if (mode === "new") {
    renderNewMode(main, { ...context, strings, language, gameText, challenges, rerender });
  } else {
    renderProMode(main, { ...context, strings, language, gameText, challenges, rerender });
  }
}

function renderNewMode(main, state) {
  if (newStep === "menu") {
    const menu = document.createElement("section");
    menu.className = "new-menu";
    menu.innerHTML = `
      ${menuButton("publish", state.strings.newPublish, state.strings.newPublishHint, "↗")}
      ${menuButton("create", state.strings.newCreate, state.strings.newCreateHint, "+")}
    `;
    menu.querySelector('[data-action="publish"]').addEventListener("click", () => { newStep = "share"; state.rerender(); });
    menu.querySelector('[data-action="create"]').addEventListener("click", () => { newStep = "create"; state.rerender(); });
    main.append(menu);
    return;
  }

  const nav = sectionNav(state.strings, () => { newStep = "menu"; state.rerender(); });
  main.append(nav);
  if (newStep === "create") {
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

  const url = challengeURL(selected, state.gameList);
  const shortTime = formatTime(selected.createdAt, state.language, "short");
  section.insertAdjacentHTML("beforeend", `
    <div class="share-grid">
      <button class="qr-box" type="button" title="${escapeHTML(url)}"></button>
      <div class="share-details">
        <div class="code-line"><code>${selected.iCode}</code><time>${escapeHTML(shortTime)}</time></div>
        <input class="memo-input" aria-label="${state.strings.memo}" value="${escapeHTML(selected.memo)}">
      </div>
      <button class="share-launch" type="button"><span>↗</span><strong>${state.strings.share}</strong></button>
    </div>
  `);

  const qrButton = section.querySelector(".qr-box");
  qrButton.setAttribute("aria-label", `${state.strings.copy}: ${url}`);
  qrButton.append(createQrSvg(url, state.strings.challengeQr));

  const memo = section.querySelector(".memo-input");
  memo.addEventListener("change", () => {
    const entries = loadChallenges();
    const item = entries.find((entry) => challengeKey(entry) === selectedKey);
    if (item) item.memo = memo.value.trim();
    saveChallenges(entries);
    state.rerender();
  });
  section.querySelector(".share-launch").addEventListener("click", () => shareChallenge(url, state));
  qrButton.addEventListener("click", () => copyText(url, state.strings));
  return section;
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
  const createdAt = Date.now();
  const entry = {
    gameID: game.gameID,
    iCode: generateICode(durIdx),
    durationMark: Math.max(1, Math.round(duration / 10)),
    createdAt,
    memo: formatTime(createdAt, state.language, "long"),
  };
  const entries = loadChallenges();
  entries.unshift(entry);
  saveChallenges(entries);
  selectedKey = challengeKey(entry);
  newStep = "share";
  state.rerender();
}

function fullChallengeCard(entry, state) {
  const card = document.createElement("article");
  card.className = "challenge-card";
  const text = state.gameText[entry.gameID];
  card.innerHTML = `
    <div class="marked-icon">${iconMarkup(entry.gameID, "game-icon")}<b>${entry.durationMark}</b></div>
    <div class="game-copy"><h2>${escapeHTML(text.name)} <time>${escapeHTML(formatTime(entry.createdAt, state.language, "short"))}</time></h2><p>${escapeHTML(entry.memo)}</p></div>
    <button class="delete-button" type="button" aria-label="${state.strings.delete}">×</button>
  `;
  return card;
}

function compactChallengeCard(entry, state) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "compact-challenge";
  card.innerHTML = `
    <span class="marked-icon">${iconMarkup(entry.gameID, "compact-game-icon")}<b>${entry.durationMark}</b></span>
    <code>${entry.iCode.slice(-4)}</code>
    <small>${escapeHTML(entry.memo)}</small>
  `;
  card.setAttribute("aria-label", `${state.gameText[entry.gameID].name}, ${entry.memo}`);
  return card;
}

function confirmDelete(entry, state) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal-card">
      <h2>🗑 ${state.strings.deleteTitle}</h2>
      <p class="disclaimer">${state.strings.deleteBody}</p>
      <div class="modal-actions">
        <button class="action-button cancel" type="button">${state.strings.cancel}</button>
        <button class="action-button danger confirm" type="button">${state.strings.delete}</button>
      </div>
    </div>
  `;
  backdrop.querySelector(".cancel").addEventListener("click", () => backdrop.remove());
  backdrop.querySelector(".confirm").addEventListener("click", () => {
    const entries = loadChallenges().filter((item) => challengeKey(item) !== challengeKey(entry));
    saveChallenges(entries);
    if (selectedKey === challengeKey(entry)) selectedKey = entries[0] ? challengeKey(entries[0]) : null;
    backdrop.remove();
    state.rerender();
  });
  document.body.append(backdrop);
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

async function shareChallenge(url, state) {
  const nickname = document.querySelector(".nickname-button")?.textContent?.trim() || "Player";
  const text = `${nickname} · FPCodex`;
  if (navigator.share) {
    try { await navigator.share({ title: "FPCodex", text, url }); return; } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  await copyText(url, state.strings);
}

async function copyText(text, strings) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(strings.copied);
  } catch {
    prompt(strings.copy, text);
  }
}

function showToast(text) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = text;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 1400);
}

function challengeURL(entry, gameList) {
  const gameIdx = gameList.findIndex((item) => item.gameID === entry.gameID);
  if (gameIdx < 0) throw new Error(`Unknown gameID: ${entry.gameID}`);
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("g", String(gameIdx));
  url.searchParams.set("c", entry.iCode);
  return url.href;
}

function challengeKey(entry) { return `${entry.gameID}:${entry.iCode}`; }

function formatTime(value, language, style) {
  const options = style === "short"
    ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" };
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", options).format(new Date(value));
}

async function loadGameText(gameList, language) {
  const pairs = await Promise.all(gameList.map(async (game) => {
    const module = await import(`./${game.gameID}/lang.js`);
    return [game.gameID, module.GAME_LANG[language] ?? module.GAME_LANG.en];
  }));
  return Object.fromEntries(pairs);
}

function menuButton(action, title, hint, mark) {
  return `<button class="new-menu-button" type="button" data-action="${action}"><span class="menu-mark">${mark}</span><span><strong>${title}</strong><small>${hint}</small></span></button>`;
}

function sectionNav(strings, callback) {
  const nav = document.createElement("nav");
  nav.className = "section-nav";
  nav.innerHTML = `<button type="button">←</button>`;
  nav.querySelector("button").addEventListener("click", callback);
  return nav;
}
