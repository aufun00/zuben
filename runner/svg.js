export const RUNNER_SVG = Object.freeze({
  motorcycle: `<symbol id="runner-motorcycle" viewBox="-40 -60 80 120">
    <ellipse cx="0" cy="40" rx="17" ry="31" fill="#171b24" stroke="#dbe7ff" stroke-width="5"/>
    <path d="M-28 12L-17-29L0-48L17-29L28 12L14 33H-14Z" fill="#5a7cff" stroke="#dbe7ff" stroke-width="4"/>
    <path d="M-18-16H18M-25 4H25" stroke="#ffcf5a" stroke-width="6" stroke-linecap="round"/>
    <circle cx="0" cy="-25" r="9" fill="#182033"/>
  </symbol>`,
  cone: `<symbol id="runner-cone" viewBox="-40 -50 80 100">
    <path d="M0-43L28 31H-28Z" fill="#ff784e" stroke="#fff0dd" stroke-width="5"/>
    <path d="M-18 3H18" stroke="#fff0dd" stroke-width="10"/>
    <rect x="-38" y="31" width="76" height="13" rx="5" fill="#30384a"/>
  </symbol>`,
  acceleration: `<symbol id="runner-acceleration" viewBox="-50 -50 100 100">
    <rect x="-47" y="-38" width="94" height="76" rx="15" fill="#174f44" stroke="#67efbd" stroke-width="5"/>
    <path d="M-29 12L0-19L29 12M-29 30L0-1L29 30" fill="none" stroke="#baffdf" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>`,
  deceleration: `<symbol id="runner-deceleration" viewBox="-50 -50 100 100">
    <rect x="-47" y="-38" width="94" height="76" rx="15" fill="#5a2a37" stroke="#ff8aa2" stroke-width="5"/>
    <path d="M-29-13L0 18L29-13M-29 5L0 36L29 5" fill="none" stroke="#ffd4dc" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  </symbol>`,
  coin: `<symbol id="runner-coin" viewBox="-50 -50 100 100">
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
