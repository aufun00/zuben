export const RUNNER_SVG = Object.freeze({
  motorcycle: `<symbol id="runner-motorcycle" viewBox="-40 -60 80 120">
    <ellipse cx="0" cy="40" rx="17" ry="31" fill="#171b24" stroke="#dbe7ff" stroke-width="5"/>
    <path d="M-28 12L-17-29L0-48L17-29L28 12L14 33H-14Z" fill="#5a7cff" stroke="#dbe7ff" stroke-width="4"/>
    <path d="M-18-16H18M-25 4H25" stroke="#ffcf5a" stroke-width="6" stroke-linecap="round"/>
    <circle cx="0" cy="-25" r="9" fill="#182033"/>
  </symbol>`,
  cone: `<symbol id="runner-cone" viewBox="-40 -50 80 100">
    <path d="M-25 30L-9-30Q-7-40 0-40Q7-40 9-30L25 30Z" fill="#f28c28"/>
    <rect x="-38" y="29" width="76" height="15" rx="2" fill="#171717"/>
  </symbol>`,
  acceleration: `<symbol id="runner-acceleration" viewBox="-50 -28 100 56">
    <path d="M-34-20H34L46 20H-46Z" fill="#58c985"/>
    <path d="M-18 8L0-8L18 8M-18 20L0 4L18 20" fill="none" stroke="#f4f4ee" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>`,
  deceleration: `<symbol id="runner-deceleration" viewBox="-50 -28 100 56">
    <path d="M-34-20H34L46 20H-46Z" fill="#e66f73"/>
    <path d="M-18-8L0 8L18-8M-18 4L0 20L18 4" fill="none" stroke="#f4f4ee" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>`,
  coin: `<symbol id="runner-coin" viewBox="-65 -65 130 130">
    <circle r="38" fill="#f5b82e" stroke="#fff1a6" stroke-width="7"/>
    <path d="M0-22V22M-12-13C-12-24 17-25 17-10C17 4-17-1-17 13C-17 26 13 25 13 14" fill="none" stroke="#8a5411" stroke-width="7" stroke-linecap="round"/>
  </symbol>`,
  diamond: `<symbol id="runner-diamond" viewBox="-50 -50 100 100">
    <path d="M-42-15L-22-38H22L42-15L0 40Z" fill="#79dcff" stroke="#e7fbff" stroke-width="6"/>
    <path d="M-42-15H42M-22-38L0 40L22-38M0-38L-14-15L0 40L14-15Z" fill="none" stroke="#267ba6" stroke-width="4"/>
  </symbol>`,
  heart: `<symbol id="runner-heart" viewBox="0 0 100 90"><path d="M50 84L10 47C-17 20 19-12 50 18C81-12 117 20 90 47Z" fill="#ff5d76" stroke="#ffd7df" stroke-width="6"/></symbol>`,
  heartEmpty: `<symbol id="runner-heart-empty" viewBox="0 0 100 90"><path d="M50 84L10 47C-17 20 19-12 50 18C81-12 117 20 90 47Z" fill="none" stroke="#ff91a2" stroke-width="7"/></symbol>`,
});

export function runnerSymbolMarkup() {
  return Object.values(RUNNER_SVG).join("");
}
