import { LANG } from "../lang.js";
import { getPreference, setPreference } from "./storage.js";
import { iconMarkup } from "./icons.js";

export function getLanguage() {
  const fallback = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  return getPreference("language", fallback) === "zh" ? "zh" : "en";
}

export function getMode() {
  return getPreference("mode", "new") === "pro" ? "pro" : "new";
}

export function renderHeader(container, { version, onModeChange, onLanguageChange }) {
  const language = getLanguage();
  const strings = LANG[language];
  const mode = getMode();
  const nickname = getPreference("nickname", strings.nickname);

  const header = document.createElement("header");
  header.className = "app-header";
  header.innerHTML = `
    <button class="brand-button" type="button" aria-label="Home">${iconMarkup("logo", "brand-mark")}</button>
    <button class="header-button nickname-button" type="button">${escapeHTML(nickname)}</button>
    <span class="header-spacer"></span>
    <button class="header-button mode-button" type="button">${mode === "new" ? strings.modeNew : strings.modePro}</button>
    <button class="header-button language-button" type="button">${language === "zh" ? "中" : "EN"}</button>
    <span class="version-label">v${version}</span>
  `;

  header.querySelector(".brand-button").addEventListener("click", () => {
    history.pushState(null, "", location.pathname);
    dispatchEvent(new Event("fp:navigate-home"));
  });
  header.querySelector(".nickname-button").addEventListener("click", () => editNickname(strings, nickname, () => onLanguageChange?.()));
  header.querySelector(".mode-button").addEventListener("click", () => {
    const next = mode === "new" ? "pro" : "new";
    setPreference("mode", next);
    onModeChange?.(next);
  });
  header.querySelector(".language-button").addEventListener("click", () => {
    const next = language === "zh" ? "en" : "zh";
    setPreference("language", next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    onLanguageChange?.(next);
  });

  container.append(header);
  return { language, strings, mode, nickname };
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
    onSaved();
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
