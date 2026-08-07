import { EFFECT_A, EFFECT_B, EFFECT_C, EFFECT_D, EFFECT_NONE, EFFECT_PRIORITY } from "./config.js";
import { createGameAudio } from "../common/game-audio.js";

const OPERATION_RESOLVE = "RESOLVE";
const MASTER_GAIN = 0.5;

export function selectResolveSound(beforeEffects, triggered) {
  for (const effect of EFFECT_PRIORITY) {
    if (triggered.some((index) => beforeEffects[index] === effect)) return effect;
  }
  return EFFECT_NONE;
}

export function createMatch3Sound({ surface, durationMS }) {
  const audio = createGameAudio({ surface, masterGain: MASTER_GAIN, createBuffers: (context) => createBuffers(context, durationMS / 1_000) });

  function sync(snapshot) {
    const transition = snapshot?.transition;
    if (snapshot?.operation !== OPERATION_RESOLVE || !transition) { audio.clearPending(); return; }
    const key = `${transition.startGT}:${transition.endGT}`;
    const effect = selectResolveSound(transition.beforeEffects, transition.triggered ?? []);
    audio.play({
      key,
      soundID: effect,
      offsetMS: snapshot.runGT - transition.startGT,
      gain: effect === EFFECT_A ? 1 : effect === EFFECT_D ? 0.9 : 0.82,
      pan: effect === EFFECT_B ? -0.18 : effect === EFFECT_C ? 0.18 : 0,
    });
  }
  return Object.freeze({
    sync,
    setVisible: audio.setVisible,
    destroy: audio.destroy,
  });
}

function createBuffers(context, duration) {
  const recipes = new Map([
    [EFFECT_NONE, (data, rate) => crystal(data, rate, 0x18a2f31d, [[0, 2700, .9], [.035, 2100, .58], [.09, 1450, .34]])],
    [EFFECT_A, explosion],
    [EFFECT_B, (data, rate) => crystal(data, rate, 0x3b7d12e9, [[0, 2900, .82], [.055, 2050, .54], [.14, 1150, .32]], 8)],
    [EFFECT_C, (data, rate) => crystal(data, rate, 0x5c91a7b3, [[0, 2400, .85], [.045, 1650, .56], [.13, 850, .34]], 7)],
    [EFFECT_D, denseCrystal],
  ]);
  return new Map([...recipes].map(([effect, recipe]) => {
    const length = Math.max(1, Math.ceil(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
    recipe(data, context.sampleRate); normalize(data);
    return [effect, buffer];
  }));
}

function crystal(data, rate, seed, bursts, decay = 12) {
  for (let index = 0; index < bursts.length; index += 1) {
    const [start, frequency, amplitude] = bursts[index];
    addShard(data, rate, start, frequency, amplitude, decay + index * 2, seed + index * 0x9e3779b9);
  }
}

function explosion(data, rate) {
  const random = seeded(0xa17e4d29); let smooth = 0;
  for (let index = 0; index < data.length; index += 1) {
    const time = index / rate, envelope = Math.exp(-time * 6.5);
    smooth = smooth * .94 + (random() * 2 - 1) * .06;
    const thump = Math.sin(2 * Math.PI * (82 * time - 48 * time * time));
    data[index] += envelope * (smooth * 1.8 + thump * .65);
  }
  addShard(data, rate, .025, 1800, .34, 13, 0x7f4a7c15);
  addShard(data, rate, .09, 950, .22, 10, 0x6d2b79f5);
}

function denseCrystal(data, rate) {
  const random = seeded(0xd35ec7a1);
  for (let index = 0; index < 12; index += 1) {
    const start = index * .018 + random() * .014;
    const frequency = 1100 + random() * 2600;
    addShard(data, rate, start, frequency, .25 + random() * .26, 11 + random() * 9, 0x45d9f3b + index * 0x9e3779b9);
  }
}

function addShard(data, rate, start, frequency, amplitude, decay, seed) {
  const first = Math.floor(start * rate), random = seeded(seed); let previousNoise = 0;
  for (let index = first; index < data.length; index += 1) {
    const time = (index - first) / rate, envelope = Math.exp(-time * decay);
    if (envelope < .0005) break;
    const noise = random() * 2 - 1, edge = noise - previousNoise * .72; previousNoise = noise;
    const tone = Math.sin(2 * Math.PI * (frequency * time - frequency * .34 * time * time));
    data[index] += amplitude * envelope * (tone * .58 + edge * .42);
  }
}

function normalize(data) {
  let peak = 0; for (const value of data) peak = Math.max(peak, Math.abs(value));
  const scale = peak > .94 ? .94 / peak : 1;
  if (scale !== 1) for (let index = 0; index < data.length; index += 1) data[index] *= scale;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
}
