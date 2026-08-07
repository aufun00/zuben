export function createGameAudio({ surface, createBuffers, masterGain = 0.5 } = {}) {
  if (typeof createBuffers !== "function") throw new TypeError("createBuffers must be a function");
  const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  let context = null;
  let master = null;
  let buffers = null;
  let resumePending = null;
  let pending = null;
  let lastKey = null;
  let destroyed = false;
  let visible = !document.hidden;
  const active = new Set();

  function unlock() {
    if (destroyed || !AudioContextClass) return;
    if (context === null) {
      try { context = new AudioContextClass({ latencyHint: "interactive" }); }
      catch { try { context = new AudioContextClass(); } catch { context = null; return; } }
      try {
        master = context.createGain();
        master.gain.value = masterGain;
        master.connect(context.destination);
        requestResume();
        startSilentUnlock(context, master);
      } catch {
        if (context.state !== "closed") context.close().catch(() => {});
        context = null;
        master = null;
        return;
      }
      queueMicrotask(() => {
        if (destroyed || !context || context.state === "closed") return;
        try { buffers = createBuffers(context); playPending(); }
        catch { buffers = null; pending = null; }
      });
    } else if (visible && context.state !== "running" && context.state !== "closed") requestResume();
    else playPending();
  }

  function requestResume() {
    if (!visible || !context || context.state === "closed") return;
    if (context.state === "running") { removeUnlockListeners(); playPending(); return; }
    if (resumePending) return;
    try {
      resumePending = Promise.resolve(context.resume()).then(() => {
        resumePending = null;
        if (destroyed || !context) return;
        if (context.state === "running") removeUnlockListeners();
        playPending();
      }).catch(() => { resumePending = null; });
    } catch { resumePending = null; }
  }

  function play({ key, soundID, offsetMS = 0, gain = 1, pan = 0 } = {}) {
    if (destroyed || !visible || key === lastKey) return false;
    if (typeof key !== "string" || !key || soundID === undefined || soundID === null) throw new TypeError("Audio events require a key string and soundID");
    pending = { key, soundID, offsetMS, gain, pan };
    playPending();
    return true;
  }

  function playPending() {
    if (destroyed || !visible || !pending || !context || context.state !== "running" || !buffers) return;
    const event = pending;
    if (event.key === lastKey) { pending = null; return; }
    const buffer = buffers.get(event.soundID);
    if (!buffer) { pending = null; return; }
    try {
      const source = context.createBufferSource();
      const gainNode = context.createGain();
      source.buffer = buffer;
      gainNode.gain.value = event.gain;
      source.connect(gainNode);
      let tail = gainNode;
      if (typeof context.createStereoPanner === "function" && event.pan !== 0) {
        const panner = context.createStereoPanner();
        panner.pan.value = event.pan;
        gainNode.connect(panner);
        tail = panner;
      }
      tail.connect(master);
      source.onended = () => {
        active.delete(source);
        source.disconnect();
        gainNode.disconnect();
        if (tail !== gainNode) tail.disconnect();
      };
      const offset = Math.max(0, Math.min(buffer.duration - 0.001, Number(event.offsetMS) / 1_000 || 0));
      source.start(0, offset);
      active.add(source);
      lastKey = event.key;
      pending = null;
    } catch {}
  }

  function stop() {
    for (const source of active) { try { source.stop(); } catch {} }
    active.clear();
  }

  function removeUnlockListeners() {
    for (const type of ["click", "keydown"]) surface?.removeEventListener(type, unlock, true);
  }

  surface?.addEventListener("click", unlock, true);
  surface?.addEventListener("keydown", unlock, true);
  return Object.freeze({
    play,
    clearPending() { pending = null; },
    setVisible(value) {
      visible = Boolean(value);
      if (!visible) { pending = null; stop(); context?.suspend().catch(() => {}); }
      else if (context && context.state !== "running" && context.state !== "closed") requestResume();
      else playPending();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pending = null;
      stop();
      removeUnlockListeners();
      if (context && context.state !== "closed") context.close().catch(() => {});
      context = null;
      master = null;
      buffers = null;
      resumePending = null;
    },
  });
}

function startSilentUnlock(context, destination) {
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, context.sampleRate);
  source.connect(destination);
  source.onended = () => source.disconnect();
  source.start(0);
}
