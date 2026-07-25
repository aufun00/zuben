const ICONS = {
  logo: `<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 2 29 9.5v13L16 30 3 22.5v-13L16 2Zm0 5.2L8 11.8v8.4l8 4.6 8-4.6v-8.4l-8-4.6Z"/><circle cx="16" cy="16" r="4" fill="currentColor"/></svg>`,
  match3: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="6" width="15" height="15" rx="5" fill="#85f2c5"/><rect x="27" y="6" width="15" height="15" rx="7.5" fill="#a9a0ff"/><rect x="6" y="27" width="15" height="15" rx="3" fill="#ffb86b"/><path d="m34.5 26 9 16h-18l9-16Z" fill="#ff7385"/></svg>`,
  stacker: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m24 4 18 9-18 9L6 13l18-9Z" fill="#a9a0ff"/><path d="m8 21 16 8 16-8v9l-16 8-16-8v-9Z" fill="#85f2c5"/><path d="m13 36 11 5.5L35 36v5L24 47 13 41v-5Z" fill="#ffb86b"/></svg>`,
  runner: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 5h16l8 38H8L16 5Z" fill="#252b40"/><path d="M23 8h2v7h-2zm0 12h2v8h-2zm0 13h2v10h-2z" fill="#f7f7fb"/><path d="m13 31 9-8 5 5-9 8-5-5Z" fill="#85f2c5"/><circle cx="16" cy="37" r="4" fill="#a9a0ff"/><circle cx="29" cy="25" r="4" fill="#a9a0ff"/></svg>`,
};

export function iconMarkup(iconID, className = "") {
  const svg = ICONS[iconID] ?? ICONS.logo;
  return `<span class="${className}" data-icon="${iconID}">${svg}</span>`;
}
