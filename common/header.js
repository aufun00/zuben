import { LANG, LOCALES } from "../lang.js";
import { getPreference, setPreference } from "./storage.js";
import { iconMarkup } from "./icons.js";

export function getLanguage() {
  const fallback = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  const stored = getPreference("language", fallback);
  return LOCALES.some((locale) => locale.id === stored) && LANG[stored] ? stored : fallback;
}

export function getMode() {
  return getPreference("mode", "new") === "pro" ? "pro" : "new";
}

export function renderHeader(container, { version, onModeChange, onLanguageChange }) {
  let language = getLanguage();
  let strings = LANG[language];
  let locale = LOCALES.find((item) => item.id === language) ?? LOCALES[0];
  document.documentElement.lang = locale.htmlLang;
  let mode = getMode();
  let nickname = getPreference("nickname", strings.nickname);

  const header = document.createElement("header");
  header.className = "app-header";
  header.innerHTML = `
    <button class="brand-button" type="button" aria-label="${escapeHTML(strings.home)}" title="${escapeHTML(strings.home)}">${iconMarkup("logo", "brand-mark")}</button>
    <button class="header-button nickname-button" type="button" title="${escapeHTML(nickname)}">
      ${iconMarkup("user", "header-icon")}<span>${escapeHTML(nickname)}</span>
    </button>
    <span class="header-spacer"></span>
    <button class="header-button mode-button" type="button" aria-label="${mode === "new" ? strings.modeNew : strings.modePro}" title="${mode === "new" ? strings.modeNew : strings.modePro}">
      ${iconMarkup(mode === "new" ? "mode-new" : "mode-pro", "header-icon")}<span>${mode === "new" ? strings.modeNew : strings.modePro}</span>
    </button>
    <span class="language-picker">
      <button class="header-button language-button" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHTML(strings.selectLanguage)}">
        ${iconMarkup("language", "header-icon")}<span>${locale.code}</span>
      </button>
    </span>
    <span class="version-label" title="${escapeHTML(strings.version)} ${escapeHTML(version)}">
      ${iconMarkup("version", "header-icon")}<span>v${version}</span>
    </span>
  `;

  header.querySelector(".brand-button").addEventListener("click", () => {
    history.pushState(null, "", location.pathname);
    dispatchEvent(new Event("fp:navigate-home"));
  });
  const nicknameButton = header.querySelector(".nickname-button");
  nicknameButton.addEventListener("click", () => editNickname(strings, nickname, (nextNickname) => {
    nickname = nextNickname;
    nicknameButton.querySelector("span:last-child").textContent = nickname;
    nicknameButton.title = nickname;
  }));
  const modeButton = header.querySelector(".mode-button");
  modeButton.addEventListener("click", () => {
    const next = mode === "new" ? "pro" : "new";
    mode = next;
    setPreference("mode", next);
    const label = next === "new" ? strings.modeNew : strings.modePro;
    modeButton.innerHTML = `${iconMarkup(next === "new" ? "mode-new" : "mode-pro", "header-icon")}<span>${label}</span>`;
    modeButton.setAttribute("aria-label", label);
    modeButton.title = label;
    onModeChange?.(next);
  });
  const languageButton = header.querySelector(".language-button");
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
      const modeLabel = mode === "new" ? strings.modeNew : strings.modePro;
      modeButton.querySelector("span:last-child").textContent = modeLabel;
      modeButton.setAttribute("aria-label", modeLabel);
      modeButton.title = modeLabel;
      header.querySelector(".version-label").title = `${strings.version} ${version}`;
      onLanguageChange?.(nextLocale.id);
    },
  }));
  languageButton.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    languageButton.click();
  });

  container.append(header);
  return { language, strings, mode, nickname };
}

function openLanguageMenu({ header, button, language, strings, onSelect }) {
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

function editNickname(strings, current, onSaved) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <form class="modal-card">
      <h2>${strings.editNickname}</h2>
      <input name="nickname" type="text" maxlength="24" value="${escapeHTML(current)}" autocomplete="nickname">
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
  checkbox.addEventListener("change", () => submit.disabled = !checkbox.checked);
  form.querySelector(".cancel").addEventListener("click", () => backdrop.remove());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = form.elements.nickname.value.trim();
    setPreference("nickname", value || strings.nickname);
    backdrop.remove();
    onSaved(value || strings.nickname);
  });
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
  document.body.append(backdrop);
  form.elements.nickname.focus();
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}
