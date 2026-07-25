import { GAME_FLOW_CFG } from "./game-flow-config.js";

export const PHASE_INTRO = "PHASE_INTRO";
export const PHASE_PREPARING = "PHASE_PREPARING";
export const PHASE_RUNNING = "PHASE_RUNNING";
export const PHASE_PAUSED = "PHASE_PAUSED";
export const PHASE_SETTLING = "PHASE_SETTLING";
export const PHASE_ENDED = "PHASE_ENDED";

export const COMMAND_START = "COMMAND_START";
export const COMMAND_PAUSE = "COMMAND_PAUSE";
export const COMMAND_RESUME = "COMMAND_RESUME";

export function createRaceClock(limitMs, readSystemMs = () => performance.now()) {
  let elapsedMs = 0;
  let anchorMs = null;

  function nowMs() {
    const runningMs = anchorMs === null ? elapsedMs : elapsedMs + Math.max(0, Math.floor(readSystemMs() - anchorMs));
    return Math.min(limitMs, runningMs);
  }

  function start() {
    elapsedMs = 0;
    anchorMs = readSystemMs();
  }

  function pause() {
    elapsedMs = nowMs();
    anchorMs = null;
  }

  function resume() {
    if (anchorMs === null && elapsedMs < limitMs) anchorMs = readSystemMs();
  }

  function finish() {
    elapsedMs = limitMs;
    anchorMs = null;
  }

  return Object.freeze({ nowMs, start, pause, resume, finish });
}

export function createGameController({ limitMs, engine, initializeGame, settleSteps, onChange, readSystemMs, flowCfg = GAME_FLOW_CFG }) {
  const clock = createRaceClock(limitMs, readSystemMs);
  let phase = PHASE_INTRO;
  let countdown = 0;
  let result = null;
  let prepareTimer = null;
  let deadlinePending = false;
  let hidden = false;
  let destroyed = false;
  let nextSequence = 0;
  let drainingInputs = false;
  let initializingOpening = false;
  const inputQueue = [];

  const pumpTimer = setInterval(pump, flowCfg.pumpIntervalMs);

  function snapshot() {
    const raceTimeMs = clock.nowMs();
    return Object.freeze({
      phase,
      countdown,
      raceTimeMs,
      remainingMs: Math.max(0, limitMs - raceTimeMs),
      game: engine.getSnapshot(),
      result,
    });
  }

  function notify() {
    if (!destroyed) onChange?.(snapshot());
  }

  function command(value) {
    if (value === COMMAND_START && phase === PHASE_INTRO) prepare(true);
    else if (value === COMMAND_PAUSE && phase === PHASE_RUNNING) pause();
    else if (value === COMMAND_RESUME && phase === PHASE_PAUSED) prepare(false);
  }

  function prepare(isStart) {
    if (isStart && initializeGame) {
      initializeOpening();
      return;
    }
    beginPreparation(isStart);
  }

  async function initializeOpening() {
    if (initializingOpening || destroyed) return;
    initializingOpening = true;
    phase = PHASE_SETTLING;
    notify();
    const outcome = initializeGame();
    try {
      await settleSteps(outcome.steps ?? []);
    } finally {
      initializingOpening = false;
    }
    if (destroyed) return;
    if (!engine.hasLegalMove()) {
      finish("no_moves");
    } else if (hidden) {
      phase = PHASE_PAUSED;
      notify();
    } else {
      beginPreparation(true);
    }
  }

  function beginPreparation(isStart) {
    if (engine.hasLegalMove() === false) {
      finish("no_moves");
      return;
    }
    clearPrepareTimer();
    if (flowCfg.prepareCount <= 0) {
      countdown = 0;
      if (isStart) clock.start(); else clock.resume();
      phase = PHASE_RUNNING;
      notify();
      return;
    }
    phase = PHASE_PREPARING;
    countdown = flowCfg.prepareCount;
    notify();

    const tick = () => {
      if (destroyed || phase !== PHASE_PREPARING) return;
      countdown -= 1;
      if (countdown > 0) {
        notify();
        prepareTimer = setTimeout(tick, flowCfg.prepareStepMs);
        return;
      }
      prepareTimer = null;
      if (isStart) clock.start(); else clock.resume();
      phase = PHASE_RUNNING;
      notify();
    };
    prepareTimer = setTimeout(tick, flowCfg.prepareStepMs);
  }

  function pause() {
    clock.pause();
    phase = PHASE_PAUSED;
    notify();
  }

  function submitAction(action) {
    if (phase !== PHASE_RUNNING) return Promise.resolve(false);
    const raceTimeMs = clock.nowMs();
    if (raceTimeMs >= limitMs) {
      finish("deadline");
      return Promise.resolve(false);
    }
    const input = Object.freeze({ timeMs: raceTimeMs, sequence: nextSequence++, action: Object.freeze(action) });
    return new Promise((resolve) => {
      inputQueue.push({ input, resolve });
      drainInputQueue();
    });
  }

  async function drainInputQueue() {
    if (drainingInputs) return;
    drainingInputs = true;
    while (inputQueue.length) {
      const queued = inputQueue.shift();
      queued.resolve(await processInput(queued.input));
    }
    drainingInputs = false;
  }

  async function processInput(input) {
    if (phase !== PHASE_RUNNING || input.timeMs >= limitMs) return false;
    const outcome = engine.applySwap(input.action.from, input.action.to, limitMs - input.timeMs);
    if (!outcome.accepted) return false;

    phase = PHASE_SETTLING;
    notify();
    try {
      await settleSteps(outcome.steps);
    } finally {
      if (destroyed || phase === PHASE_ENDED) return true;
      if (deadlinePending || clock.nowMs() >= limitMs) {
        finish("deadline");
      } else if (!engine.hasLegalMove()) {
        finish("no_moves");
      } else if (hidden) {
        clock.pause();
        phase = PHASE_PAUSED;
        notify();
      } else {
        phase = PHASE_RUNNING;
        notify();
      }
    }
    return true;
  }

  function handleVisibility(isHidden) {
    hidden = isHidden;
    if (!isHidden) return;
    if (phase === PHASE_PREPARING) {
      clearPrepareTimer();
      phase = PHASE_PAUSED;
      countdown = 0;
      notify();
    } else if (phase === PHASE_RUNNING) {
      pause();
    } else if (phase === PHASE_SETTLING) {
      clock.pause();
    }
  }

  function pump() {
    if (destroyed) return;
    if (initializingOpening) return;
    if (phase !== PHASE_RUNNING && phase !== PHASE_SETTLING) return;
    if (clock.nowMs() >= limitMs) {
      if (phase === PHASE_SETTLING) deadlinePending = true;
      else finish("deadline");
    } else {
      notify();
    }
  }

  function finish(reason) {
    if (phase === PHASE_ENDED) return;
    clearPrepareTimer();
    clock.finish();
    const game = engine.getSnapshot();
    result = Object.freeze({ score: game.score, reason, endedAtMs: limitMs });
    phase = PHASE_ENDED;
    countdown = 0;
    notify();
  }

  function clearPrepareTimer() {
    if (prepareTimer !== null) clearTimeout(prepareTimer);
    prepareTimer = null;
  }

  function destroy() {
    destroyed = true;
    clearPrepareTimer();
    clearInterval(pumpTimer);
  }

  if (initializeGame || engine.hasLegalMove()) notify();
  else finish("no_moves");
  return Object.freeze({ command, submitAction, handleVisibility, snapshot, destroy });
}
