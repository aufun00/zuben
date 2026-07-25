import { GAME_FLOW_CFG } from "./game-flow-config.js";

export const PHASE_INTRO = "PHASE_INTRO";
export const PHASE_PREPARING = "PHASE_PREPARING";
export const PHASE_RUNNING = "PHASE_RUNNING";
export const PHASE_PAUSED = "PHASE_PAUSED";
export const PHASE_SETTLING = "PHASE_SETTLING";
export const PHASE_ENDED = "PHASE_ENDED";
export const PHASE_ERROR = "PHASE_ERROR";

export const COMMAND_START = "COMMAND_START";
export const COMMAND_PAUSE = "COMMAND_PAUSE";
export const COMMAND_RESUME = "COMMAND_RESUME";

const EMPTY_GAME_SNAPSHOT = Object.freeze({ score: 0 });

export function createRaceClock(limitMs, readSystemMs = () => performance.now()) {
  let elapsedExactMs = 0;
  let anchorMs = null;

  function nowMs() {
    const runningMs = anchorMs === null ? elapsedExactMs : elapsedExactMs + Math.max(0, readSystemMs() - anchorMs);
    return Math.min(limitMs, Math.floor(runningMs));
  }

  function start() {
    elapsedExactMs = 0;
    anchorMs = readSystemMs();
  }

  function pause() {
    if (anchorMs !== null) elapsedExactMs = Math.min(limitMs, elapsedExactMs + Math.max(0, readSystemMs() - anchorMs));
    anchorMs = null;
  }

  function resume() {
    if (anchorMs === null && elapsedExactMs < limitMs) anchorMs = readSystemMs();
  }

  function finish() {
    elapsedExactMs = limitMs;
    anchorMs = null;
  }

  return Object.freeze({ nowMs, start, pause, resume, finish });
}

export function createGameController({ limitMs, engine, initializeGame, applyAction, settleSteps, onChange, onError, readSystemMs, flowCfg = GAME_FLOW_CFG }) {
  const clock = createRaceClock(limitMs, readSystemMs);
  let phase = PHASE_INTRO;
  let countdown = 0;
  let result = null;
  let prepareTimer = null;
  let deadlinePending = false;
  let interrupted = false;
  let interruptionPausePending = false;
  let concealed = false;
  let destroyed = false;
  let nextSequence = 0;
  let drainingInputs = false;
  let initializingOpening = false;
  let failure = null;
  let activeInput = null;
  let lastGameSnapshot = null;
  const inputQueue = [];

  const pumpTimer = setInterval(() => runSafely(pump), flowCfg.pumpIntervalMs);

  function snapshot() {
    try {
      return createSnapshot(failure ? lastGameSnapshot ?? EMPTY_GAME_SNAPSHOT : engine.getSnapshot());
    } catch (error) {
      fail(error);
      return createSnapshot(lastGameSnapshot ?? EMPTY_GAME_SNAPSHOT);
    }
  }

  function createSnapshot(game) {
    if (!failure) lastGameSnapshot = game;
    const raceTimeMs = clock.nowMs();
    return Object.freeze({ phase, countdown, concealed, raceTimeMs, remainingMs: Math.max(0, limitMs - raceTimeMs), game, result });
  }

  function notify() {
    if (destroyed || failure) return;
    const current = snapshot();
    if (!destroyed && !failure) onChange?.(current);
  }

  function command(value) {
    runSafely(() => {
      if (value === COMMAND_START && phase === PHASE_INTRO) prepare(true);
      else if (value === COMMAND_PAUSE && phase === PHASE_RUNNING) pause();
      else if (value === COMMAND_RESUME && phase === PHASE_PAUSED) prepare(false);
    });
  }

  function prepare(isStart) {
    if (isStart && initializeGame) {
      initializeOpening().catch(fail);
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
    if (!hasLegalMove()) {
      finish("no_moves");
    } else if (interrupted || interruptionPausePending) {
      interruptionPausePending = false;
      concealed = true;
      phase = PHASE_PAUSED;
      notify();
    } else {
      beginPreparation(true);
    }
  }

  function beginPreparation(isStart) {
    if (!hasLegalMove()) {
      finish("no_moves");
      return;
    }
    clearPrepareTimer();
    if (interrupted) {
      concealed = true;
      countdown = 0;
      phase = PHASE_PAUSED;
      notify();
      return;
    }
    if (flowCfg.prepareCount <= 0) {
      countdown = 0;
      if (isStart) clock.start(); else clock.resume();
      concealed = false;
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
        prepareTimer = setTimeout(() => runSafely(tick), flowCfg.prepareStepMs);
        return;
      }
      prepareTimer = null;
      if (isStart) clock.start(); else clock.resume();
      concealed = false;
      phase = PHASE_RUNNING;
      notify();
    };
    prepareTimer = setTimeout(() => runSafely(tick), flowCfg.prepareStepMs);
  }

  function pause() {
    clock.pause();
    phase = PHASE_PAUSED;
    notify();
  }

  function submitAction(action) {
    try {
      if (phase !== PHASE_RUNNING) return Promise.resolve(false);
      const raceTimeMs = clock.nowMs();
      if (raceTimeMs >= limitMs) {
        finish("deadline");
        return Promise.resolve(false);
      }
      const input = Object.freeze({ timeMs: raceTimeMs, sequence: nextSequence++, action: Object.freeze(action) });
      return new Promise((resolve, reject) => {
        inputQueue.push({ input, resolve, reject, settled: false });
        inputQueue.sort((first, second) => first.input.timeMs - second.input.timeMs || first.input.sequence - second.input.sequence);
        void drainInputQueue();
      });
    } catch (error) {
      fail(error);
      return Promise.reject(error);
    }
  }

  async function drainInputQueue() {
    if (drainingInputs || destroyed || failure) return;
    drainingInputs = true;
    try {
      while (inputQueue.length && !destroyed && !failure) {
        activeInput = inputQueue.shift();
        try {
          settleInput(activeInput, "resolve", await processInput(activeInput.input));
        } catch (error) {
          settleInput(activeInput, "reject", error);
          fail(error);
        } finally {
          activeInput = null;
        }
      }
    } finally {
      drainingInputs = false;
    }
  }

  async function processInput(input) {
    if (phase !== PHASE_RUNNING || input.timeMs >= limitMs) return false;
    const remainMs = limitMs - input.timeMs;
    const outcome = applyAction
      ? applyAction(input.action, remainMs, input.timeMs)
      : engine.applySwap(input.action.from, input.action.to, remainMs);
    if (!outcome.accepted) return false;

    phase = PHASE_SETTLING;
    notify();
    await settleSteps(outcome.steps);
    if (destroyed || failure || phase === PHASE_ENDED) return true;
    if (outcome.endReason) {
      finish(outcome.endReason);
    } else if (deadlinePending || clock.nowMs() >= limitMs) {
      finish("deadline");
    } else if (!hasLegalMove()) {
      finish("no_moves");
    } else if (interrupted || interruptionPausePending) {
      interruptionPausePending = false;
      concealed = true;
      clock.pause();
      phase = PHASE_PAUSED;
      notify();
    } else {
      phase = PHASE_RUNNING;
      notify();
    }
    return true;
  }

  function handleInterruption(isInterrupted) {
    runSafely(() => {
      interrupted = isInterrupted;
      if (!isInterrupted) return;
      concealed = true;
      if (phase === PHASE_PREPARING) {
        clearPrepareTimer();
        phase = PHASE_PAUSED;
        countdown = 0;
        notify();
      } else if (phase === PHASE_RUNNING) {
        pause();
      } else if (phase === PHASE_SETTLING) {
        interruptionPausePending = true;
        clock.pause();
        notify();
      }
    });
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
    interruptionPausePending = false;
    concealed = false;
    clock.finish();
    const game = engine.getSnapshot();
    result = Object.freeze({ score: game.score, reason });
    phase = PHASE_ENDED;
    countdown = 0;
    notify();
  }

  function hasLegalMove() {
    return typeof engine.hasLegalMove !== "function" || engine.hasLegalMove() !== false;
  }

  function clearPrepareTimer() {
    if (prepareTimer !== null) clearTimeout(prepareTimer);
    prepareTimer = null;
  }

  function runSafely(callback) {
    if (destroyed || failure) return;
    try {
      callback();
    } catch (error) {
      fail(error);
    }
  }

  function fail(reason) {
    if (destroyed || failure) return;
    failure = reason instanceof Error ? reason : new Error(String(reason));
    clearPrepareTimer();
    clearInterval(pumpTimer);
    try { clock.pause(); } catch {}
    phase = PHASE_ERROR;
    countdown = 0;
    deadlinePending = false;
    interruptionPausePending = false;
    concealed = false;
    rejectQueuedInputs(failure);
    try {
      onError?.(failure);
    } catch (reportingError) {
      console.error("Game error handler failed", reportingError);
    }
  }

  function settleInput(entry, method, value) {
    if (!entry || entry.settled) return;
    entry.settled = true;
    entry[method](value);
  }

  function rejectQueuedInputs(error) {
    settleInput(activeInput, "reject", error);
    while (inputQueue.length) settleInput(inputQueue.shift(), "reject", error);
  }

  function createAbortError() {
    const error = new Error("Game controller was destroyed");
    error.name = "AbortError";
    return error;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearPrepareTimer();
    clearInterval(pumpTimer);
    rejectQueuedInputs(createAbortError());
  }

  runSafely(() => {
    if (initializeGame || hasLegalMove()) notify();
    else finish("no_moves");
  });
  return Object.freeze({ command, submitAction, handleInterruption, snapshot, destroy });
}
