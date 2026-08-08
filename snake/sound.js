import { createGameAudio } from "../common/game-audio.js";

export const SNAKE_SOUND_FORAGE = "forage";
export const SNAKE_SOUND_PREDATION = "predation";
export const SNAKE_SOUND_ANT = "ant";
export const SNAKE_SOUND_MYSTERY = "mystery";
export const SNAKE_SOUND_COIN = "coin";
export const SNAKE_SOUND_DEATH = "death";

export function createSnakeSound({ surface } = {}) {
  const audio = createGameAudio({ surface, masterGain: 0.48, createBuffers: createSnakeSoundBuffers });
  function sync(snapshot) {
    const event = snapshot?.lastSound;
    if (!event) { audio.clearPending(); return; }
    audio.play({ key: `snake:${event.id}`, soundID: event.soundID, offsetMS: snapshot.runGT - event.atGT, gain: event.soundID === SNAKE_SOUND_ANT ? 0.55 : 0.9 });
  }
  return Object.freeze({ sync, setVisible: audio.setVisible, destroy: audio.destroy });
}

export function createSnakeSoundBuffers(context) {
  return new Map([
    [SNAKE_SOUND_FORAGE, toneBuffer(context, 0.11, [[0, 720], [0.045, 920]])],
    [SNAKE_SOUND_PREDATION, toneBuffer(context, 0.14, [[0, 260], [0.035, 390], [0.075, 520]], 0.85)],
    [SNAKE_SOUND_ANT, toneBuffer(context, 0.08, [[0, 180]], 0.6)],
    [SNAKE_SOUND_MYSTERY, toneBuffer(context, 0.24, [[0, 440], [0.07, 554.37], [0.14, 659.25]])],
    [SNAKE_SOUND_COIN, toneBuffer(context, 0.2, [[0, 523.25], [0.055, 659.25], [0.11, 783.99], [0.145, 1046.5]])],
    [SNAKE_SOUND_DEATH, sweepBuffer(context, 0.2)],
  ]);
}

function toneBuffer(context, duration, notes, strength = 1) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  for (const [start, frequency] of notes) {
    const first = Math.floor(start * context.sampleRate);
    for (let index = first; index < data.length; index += 1) {
      const time = (index - first) / context.sampleRate;
      const envelope = Math.min(1, time / 0.003) * Math.exp(-time * 28);
      data[index] += (Math.sin(2 * Math.PI * frequency * time) + 0.22 * Math.sin(4 * Math.PI * frequency * time)) * envelope * strength;
    }
  }
  normalize(data); return buffer;
}

function sweepBuffer(context, duration) {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
  const data = buffer.getChannelData(0);
  let noise = 0x6d2b79f5;
  for (let index = 0; index < data.length; index += 1) {
    const time = index / context.sampleRate, envelope = Math.exp(-time * 17);
    noise ^= noise << 13; noise ^= noise >>> 17; noise ^= noise << 5;
    const random = ((noise >>> 0) / 0x80000000) - 1;
    data[index] = envelope * (0.78 * Math.sin(2 * Math.PI * (150 * time - 210 * time * time)) + 0.25 * random);
  }
  normalize(data); return buffer;
}

function normalize(data) {
  let peak = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0.94 ? 0.94 / peak : 1;
  if (scale !== 1) for (let index = 0; index < data.length; index += 1) data[index] *= scale;
}
