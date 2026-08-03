import { openModal } from "./modal.js";
import { renderQr } from "./qr.js";
import { buildChallengeSharePayload, shareContent } from "./share.js";
import { formatTime } from "./challenges.js";
import { MAX_CHALLENGE_MEMO_LENGTH } from "./storage.js";

export function openChallengeShareDialog({
  challenge, gameIdx, gameDisplayName, nickname, language, strings, returnFocus, onMemoChange, modalHost,
}) {
  const { text, url } = buildChallengeSharePayload({
    nickname,
    score: challenge.score,
    gameIdx,
    gameID: challenge.gameID,
    gameDisplayName,
    iCode: challenge.iCode,
    strings,
  });
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop challenge-share-backdrop";
  backdrop.innerHTML = `
    <section class="modal-card challenge-share-dialog" role="dialog" aria-labelledby="challenge-share-title">
      <button class="share-dialog-close" type="button" aria-label="${escapeHTML(strings.close)}">×</button>
      <h2 id="challenge-share-title">${escapeHTML(strings.shareChallenge)}</h2>
      <div class="share-dialog-qr"></div>
      <div class="share-dialog-identity">
        <p class="share-dialog-copy"></p>
        ${challenge.createdAt === undefined ? "" : `<time>${escapeHTML(strings.createdAt)} · ${escapeHTML(formatTime(challenge.createdAt, language, "long"))}</time>`}
      </div>
      ${challenge.memo === undefined ? "" : `<input class="share-dialog-memo" type="text" maxlength="${MAX_CHALLENGE_MEMO_LENGTH}" aria-label="${escapeHTML(strings.memo)}" value="${escapeHTML(challenge.memo)}">`}
      <div class="share-dialog-actions">
        <a class="share-dialog-action share-dialog-open" href="${escapeHTML(url)}" target="_blank" rel="noopener">${escapeHTML(strings.startInNewTab)}</a>
        <button class="share-dialog-action" type="button" data-native-share>${escapeHTML(strings.shareMyScore)}</button>
      </div>
    </section>
  `;
  backdrop.querySelector(".share-dialog-copy").textContent = text;
  renderQr(backdrop.querySelector(".share-dialog-qr"), url, {
    label: strings.challengeQr,
    fallbackText: strings.qrUnavailable,
  });
  const closeButton = backdrop.querySelector(".share-dialog-close");
  const memo = backdrop.querySelector(".share-dialog-memo");
  let committedMemo = memo?.value.trim();
  const commitMemo = () => {
    if (!memo) return;
    const value = memo.value.trim();
    if (value === committedMemo) return;
    const persisted = onMemoChange?.(value);
    committedMemo = typeof persisted === "string" ? persisted : value;
    memo.value = committedMemo;
  };
  const modal = openModal(backdrop, { initialFocus: closeButton, returnFocus, onBeforeClose: commitMemo, host: modalHost });
  closeButton.addEventListener("click", () => modal.close(), { signal: modal.signal });
  backdrop.querySelector("[data-native-share]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await shareContent({ text, url, strings });
    } finally {
      button.disabled = false;
    }
  }, { signal: modal.signal });
  memo?.addEventListener("change", commitMemo, { signal: modal.signal });
  return modal;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}
