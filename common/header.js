import { LANG, LOCALES } from "../lang.js";
import { getPreference, isPersistentStorageAvailable, setPreference, subscribePreference, subscribeStorageAvailability } from "./storage.js";
import { iconMarkup } from "./icons.js";
import { getAppVersion, subscribeAppVersion } from "./version-state.js";
import { openModal } from "./modal.js";
import { clearLocalSiteDataAndExit } from "./site-exit.js";

export function getLanguage() {
  const fallback = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  const stored = getPreference("language", fallback);
  return LOCALES.some((locale) => locale.id === stored) && LANG[stored] ? stored : fallback;
}

export function renderHeader(container, { version, onLanguageChange, showPerformanceMeter = false, gameID = null }) {
  let activeVersion = getAppVersion();
  let language = getLanguage();
  let strings = LANG[language];
  let locale = LOCALES.find((item) => item.id === language) ?? LOCALES[0];
  document.documentElement.lang = locale.htmlLang;
  let nickname = getPreference("nickname", strings.nickname);
  const versionUnread = activeVersion !== "?" && getPreference("readedVer", "") !== activeVersion;

  const header = document.createElement("header");
  header.className = "app-header";
  header.innerHTML = `
    <button class="brand-button" type="button" aria-label="${escapeHTML(strings.home)}" title="${escapeHTML(strings.home)}">${iconMarkup("logo", "brand-mark")}</button>
    <button class="header-button nickname-button" type="button" title="${escapeHTML(nickname)}">
      ${iconMarkup("user", "header-icon")}<span>${escapeHTML(nickname)}</span>
    </button>
    <span class="header-spacer"></span>
    ${showPerformanceMeter ? '<span class="header-performance-meter" data-performance-meter-host></span>' : ""}
    <span class="language-picker">
      <button class="header-button language-button" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHTML(strings.selectLanguage)}">
        ${iconMarkup("language", "header-icon")}<span>${locale.code}</span>
      </button>
    </span>
    <span class="settings-picker">
      <button class="settings-button" type="button" data-unread="${versionUnread}" aria-haspopup="menu" aria-expanded="false" title="${escapeHTML(strings.settings)}" aria-label="${escapeHTML(strings.settings)}">
        ${iconMarkup("settings", "header-icon")}<i class="settings-unread-dot" aria-hidden="true"></i>
      </button>
    </span>
  `;

  header.querySelector(".brand-button").addEventListener("click", () => {
    history.pushState(null, "", location.pathname);
    dispatchEvent(new Event("zuben:navigate-home"));
  });
  const nicknameButton = header.querySelector(".nickname-button");
  nicknameButton.addEventListener("click", () => editNickname(strings, nickname, (nextNickname) => {
    nickname = nextNickname;
    nicknameButton.querySelector("span:last-child").textContent = nickname;
    nicknameButton.title = nickname;
  }));
  const languageButton = header.querySelector(".language-button");
  const settingsButton = header.querySelector(".settings-button");
  const performanceMeterHost = header.querySelector("[data-performance-meter-host]");
  const paintMetricsVisibility = (value = getPreference("metrics", "on")) => {
    if (performanceMeterHost) performanceMeterHost.hidden = value === "off";
  };
  paintMetricsVisibility();
  const unsubscribeMetrics = subscribePreference("metrics", paintMetricsVisibility);
  settingsButton.addEventListener("click", () => openSettingsMenu({
    header,
    button: settingsButton,
    strings,
    gameID,
    showPerformanceMeter,
    getVersion: () => activeVersion,
    onVersionRead: () => {
      if (activeVersion === "?") return;
      setPreference("readedVer", activeVersion);
      settingsButton.dataset.unread = "false";
    },
  }));
  languageButton.addEventListener("click", () => openLanguageMenu({
    header,
    button: languageButton,
    language,
    strings,
    onSelect: (nextLocale) => {
      setPreference("language", nextLocale.id);
      language = nextLocale.id;
      locale = nextLocale;
      strings = LANG[language] ?? LANG.en;
      document.documentElement.lang = nextLocale.htmlLang;
      languageButton.querySelector("span:last-child").textContent = nextLocale.code;
      languageButton.setAttribute("aria-label", strings.selectLanguage);
      const brandButton = header.querySelector(".brand-button");
      brandButton.setAttribute("aria-label", strings.home);
      brandButton.title = strings.home;
      paintVersion(activeVersion);
      settingsButton.title = strings.settings;
      settingsButton.setAttribute("aria-label", strings.settings);
      if (storageWarning) storageWarning.textContent = strings.storageUnavailable;
      onLanguageChange?.(nextLocale.id);
    },
  }));
  languageButton.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    languageButton.click();
  });

  let storageWarning = null;
  const paintStorageWarning = () => {
    if (storageWarning?.isConnected) return;
    storageWarning = document.createElement("div");
    storageWarning.className = "storage-warning";
    storageWarning.setAttribute("role", "alert");
    storageWarning.textContent = strings.storageUnavailable;
    header.after(storageWarning);
  };
  const paintVersion = (nextVersion) => {
    activeVersion = nextVersion;
    const unread = activeVersion !== "?" && getPreference("readedVer", "") !== activeVersion;
    settingsButton.dataset.unread = String(unread);
  };

  container.append(header);
  if (!isPersistentStorageAvailable()) paintStorageWarning();
  const unsubscribeStorage = subscribeStorageAvailability((available) => { if (!available) paintStorageWarning(); });
  const unsubscribeVersion = subscribeAppVersion(paintVersion);
  const cleanup = () => {
    header.querySelector(".language-menu")?.closeMenu?.();
    header.querySelector(".settings-menu")?.closeMenu?.();
    unsubscribeStorage();
    unsubscribeVersion();
    unsubscribeMetrics();
    storageWarning?.remove();
  };
  return {
    language,
    strings,
    nickname,
    performanceMeterHost,
    cleanup,
  };
}

function openExitDialog(exitButton, strings) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop exit-backdrop";
  backdrop.innerHTML = `
    <section class="modal-card exit-dialog" role="dialog" aria-labelledby="exit-dialog-title" aria-describedby="exit-dialog-body">
      <h2 id="exit-dialog-title">${escapeHTML(strings.exitTitle)}</h2>
      <p id="exit-dialog-body" class="disclaimer">${escapeHTML(strings.exitBody)}</p>
      <div class="modal-actions">
        <button class="action-button cancel" type="button">${escapeHTML(strings.cancel)}</button>
        <button class="action-button danger confirm" type="button">${escapeHTML(strings.confirm)}</button>
      </div>
    </section>
  `;
  const cancelButton = backdrop.querySelector(".cancel");
  const confirmButton = backdrop.querySelector(".confirm");
  const modal = openModal(backdrop, { initialFocus: cancelButton, returnFocus: exitButton, closeOnBackdrop: false });
  cancelButton.addEventListener("click", () => modal.close(), { signal: modal.signal });
  confirmButton.addEventListener("click", async () => {
    cancelButton.disabled = true;
    confirmButton.disabled = true;
    confirmButton.textContent = strings.exitWorking;
    await clearLocalSiteDataAndExit();
  }, { signal: modal.signal });
}

async function openVersionInfo(versionButton, strings) {
  if (document.querySelector(".version-backdrop")) return false;
  try {
    const response = await fetch(new URL("../version.json", import.meta.url));
    if (!response.ok) throw new Error(`version.json returned ${response.status}`);
    const value = await response.json();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop version-backdrop";
    backdrop.innerHTML = `
      <section class="modal-card version-dialog" role="dialog" aria-labelledby="version-dialog-title">
        <button class="version-close" type="button" aria-label="${escapeHTML(strings.close)}">×</button>
        <h2 id="version-dialog-title" class="visually-hidden">${escapeHTML(strings.version)}</h2>
        <div class="version-json"></div>
      </section>
    `;
    if (!versionButton.isConnected) return false;
    backdrop.querySelector(".version-json").append(formatVersionValue(value));
    const closeButton = backdrop.querySelector(".version-close");
    const modal = openModal(backdrop, { initialFocus: closeButton, returnFocus: versionButton });
    closeButton.addEventListener("click", () => modal.close(), { signal: modal.signal });
    return true;
  } catch (error) {
    console.error("Could not display version.json", error);
    return false;
  }
}

function formatVersionValue(value, depth = 0) {
  if (Array.isArray(value)) {
    const list = document.createElement("ul");
    list.className = "version-array";
    for (const item of value) {
      const entry = document.createElement("li");
      if (isScalar(item)) entry.textContent = displayScalar(item);
      else entry.append(formatVersionValue(item, depth + 1));
      list.append(entry);
    }
    return list;
  }
  if (value && typeof value === "object") {
    const group = document.createElement("div");
    group.className = `version-object depth-${Math.min(depth, 3)}`;
    for (const [key, item] of Object.entries(value)) {
      const field = document.createElement("section");
      field.className = "version-field";
      const label = document.createElement(depth === 0 ? "h2" : depth === 1 ? "h3" : "strong");
      label.className = "version-key";
      label.textContent = key;
      field.append(label, formatVersionValue(item, depth + 1));
      group.append(field);
    }
    return group;
  }
  const text = document.createElement("p");
  text.className = "version-value";
  text.textContent = displayScalar(value);
  return text;
}

function isScalar(value) { return value === null || typeof value !== "object"; }
function displayScalar(value) { return value === null ? "null" : String(value); }

function openLanguageMenu({ header, button, language, strings, onSelect }) {
  header.querySelector(".settings-menu")?.closeMenu?.();
  const picker = header.querySelector(".language-picker");
  const existing = picker.querySelector(".language-menu");
  if (existing) {
    existing.closeMenu();
    return;
  }

  const menu = document.createElement("div");
  menu.className = "language-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", strings.selectLanguage);
  menu.innerHTML = LOCALES.filter((locale) => LANG[locale.id]).map((locale) => `
    <button type="button" role="option" aria-selected="${locale.id === language}" data-locale="${locale.id}">
      <strong>${locale.code}</strong><span>${escapeHTML(locale.name)}</span>
    </button>
  `).join("");

  const controller = new AbortController();
  const close = ({ restoreFocus = false } = {}) => {
    controller.abort();
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };
  menu.closeMenu = close;
  button.setAttribute("aria-expanded", "true");
  picker.append(menu);

  const options = [...menu.querySelectorAll('[role="option"]')];
  for (const option of options) {
    option.addEventListener("click", () => {
      const next = LOCALES.find((locale) => locale.id === option.dataset.locale);
      close();
      if (next && next.id !== language) onSelect(next);
    });
  }

  menu.addEventListener("keydown", (event) => {
    const current = options.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = options[(current + 1) % options.length];
    if (event.key === "ArrowUp") next = options[(current - 1 + options.length) % options.length];
    if (event.key === "Home") next = options[0];
    if (event.key === "End") next = options.at(-1);
    if (next) {
      event.preventDefault();
      next.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
    } else if (event.key === "Tab") {
      close();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target)) close();
  }, { capture: true, signal: controller.signal });
  options.find((option) => option.dataset.locale === language)?.focus();
}

function openSettingsMenu({ header, button, strings, gameID, showPerformanceMeter, getVersion, onVersionRead }) {
  header.querySelector(".language-menu")?.closeMenu?.();
  const picker = header.querySelector(".settings-picker");
  const existing = picker.querySelector(".settings-menu");
  if (existing) {
    existing.closeMenu();
    return;
  }

  const menu = document.createElement("div");
  menu.className = "settings-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", strings.settings);
  const gameRows = [];
  if (gameID) {
    if (showPerformanceMeter) gameRows.push(settingToggleRow("metrics", strings.metrics));
    if (gameID === "linefit") gameRows.push(settingValueRow("linefitUIStyle", strings.uiStyle));
  }
  menu.innerHTML = `
    ${gameRows.length ? `<div class="settings-section-title">${escapeHTML(strings.gameSettings)}</div>${gameRows.join("")}<hr>` : ""}
    <div class="settings-section-title">${escapeHTML(strings.systemSettings)}</div>
    ${settingToggleRow("music", strings.music)}
    ${settingToggleRow("soundEffects", strings.soundEffects)}
    ${settingActionRow("exit", strings.exitCompletely)}
    ${settingActionRow("version", strings.version, `v${getVersion()}`)}
  `;

  const controller = new AbortController();
  const close = ({ restoreFocus = false } = {}) => {
    controller.abort();
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    if (restoreFocus) button.focus();
  };
  menu.closeMenu = close;
  button.setAttribute("aria-expanded", "true");
  picker.append(menu);

  const rows = [...menu.querySelectorAll(".settings-row")];
  const paintToggle = (key) => {
    const row = menu.querySelector(`[data-setting="${key}"]`);
    if (!row) return;
    const on = getPreference(key, "on") !== "off";
    row.setAttribute("aria-checked", String(on));
    row.querySelector(".settings-value").textContent = on ? strings.on : strings.off;
  };
  const paintUIStyle = () => {
    const row = menu.querySelector('[data-setting="linefitUIStyle"]');
    if (!row) return;
    row.querySelector(".settings-value").textContent = getPreference("linefitUIStyle", "colorful") === "duotone" ? strings.duotone : strings.colorful;
  };
  for (const key of ["metrics", "music", "soundEffects"]) paintToggle(key);
  paintUIStyle();

  for (const row of rows) {
    row.addEventListener("click", async () => {
      const key = row.dataset.setting;
      if (["metrics", "music", "soundEffects"].includes(key)) {
        setPreference(key, getPreference(key, "on") === "off" ? "on" : "off");
        paintToggle(key);
      } else if (key === "linefitUIStyle") {
        setPreference(key, getPreference(key, "colorful") === "colorful" ? "duotone" : "colorful");
        paintUIStyle();
      } else if (key === "exit") {
        close();
        openExitDialog(button, strings);
      } else if (key === "version") {
        close();
        const displayed = await openVersionInfo(button, strings);
        if (displayed) onVersionRead();
      }
    });
  }

  menu.addEventListener("keydown", (event) => {
    const current = rows.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = rows[(current + 1) % rows.length];
    if (event.key === "ArrowUp") next = rows[(current - 1 + rows.length) % rows.length];
    if (event.key === "Home") next = rows[0];
    if (event.key === "End") next = rows.at(-1);
    if (next) {
      event.preventDefault();
      next.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
    } else if (event.key === "Tab") {
      close();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target)) close();
  }, { capture: true, signal: controller.signal });
  rows[0]?.focus();
}

function settingToggleRow(key, label) {
  return `<button class="settings-row" type="button" role="menuitemcheckbox" data-setting="${key}"><span>${escapeHTML(label)}</span><span class="settings-value"></span></button>`;
}

function settingValueRow(key, label) {
  return `<button class="settings-row" type="button" role="menuitem" data-setting="${key}"><span>${escapeHTML(label)}</span><span class="settings-value"></span></button>`;
}

function settingActionRow(key, label, value = "") {
  return `<button class="settings-row" type="button" role="menuitem" data-setting="${key}"><span>${escapeHTML(label)}</span><span class="settings-value">${escapeHTML(value)}</span></button>`;
}

function editNickname(strings, current, onSaved) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <form class="modal-card nickname-dialog" role="dialog" aria-labelledby="nickname-dialog-title">
      <h2 id="nickname-dialog-title">${strings.editNickname}</h2>
      <input name="nickname" type="text" maxlength="24" value="${escapeHTML(current)}" autocomplete="nickname" aria-label="${escapeHTML(strings.nickname)}">
      <p class="disclaimer">${strings.nicknameDisclaimer}</p>
      <label class="confirm-row"><input name="read" type="checkbox"><span>${strings.disclaimerRead}</span></label>
      <div class="modal-actions">
        <button class="action-button cancel" type="button">${strings.cancel}</button>
        <button class="action-button primary" type="submit" disabled>${strings.confirm}</button>
      </div>
    </form>
  `;
  const form = backdrop.querySelector("form");
  const checkbox = form.elements.read;
  const submit = form.querySelector('[type="submit"]');
  const modal = openModal(backdrop, { initialFocus: form.elements.nickname });
  checkbox.addEventListener("change", () => submit.disabled = !checkbox.checked, { signal: modal.signal });
  form.querySelector(".cancel").addEventListener("click", () => modal.close(), { signal: modal.signal });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = form.elements.nickname.value.trim();
    setPreference("nickname", value || strings.nickname);
    modal.close();
    onSaved(value || strings.nickname);
  }, { signal: modal.signal });
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}
