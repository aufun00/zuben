export function buildChallengeURL({ gameIdx, iCode, resultCode, baseHref = location.href }) {
  const base = new URL(baseHref);
  const url = new URL(base.pathname, base.origin);
  url.searchParams.set("g", String(gameIdx));
  url.searchParams.set("c", iCode);
  if (resultCode) url.searchParams.set("r", resultCode);
  return url.href;
}

export function scoreShareText(nickname, score, gameDisplayName, iCode, strings) {
  return `${nickname}${strings.scoreShareAfterNickname}${score}${strings.scoreShareAfterScore}${gameDisplayName} # ${iCode.slice(-4)}`;
}

export function inviteShareText(nickname, gameDisplayName, strings) {
  return `${nickname}${strings.inviteShareAfterNickname}${gameDisplayName}`;
}

export async function shareContent({ text, url, strings, title = "Zuben", navigatorObject = navigator }) {
  if (typeof navigatorObject.share === "function") {
    try {
      await navigatorObject.share({ title, text, url });
      return "shared";
    } catch (error) {
      if (error?.name === "AbortError") return "cancelled";
    }
  }
  await copyText(`${text}\n${url}`, strings, navigatorObject);
  return "copied";
}

export async function copyText(text, strings, navigatorObject = navigator) {
  try {
    await navigatorObject.clipboard.writeText(text);
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
