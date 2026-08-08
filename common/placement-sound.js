export const PLACEMENT_SOUND_PRECISE = "precise-land";
export const PLACEMENT_SOUND_HEAVY = "heavy-land";
export const PLACEMENT_SOUND_LIGHT = "light-land";

export function createPlacementSoundBuffers(context) {
  return new Map([
    [PLACEMENT_SOUND_PRECISE, createBuffer(context, 0.14, preciseLanding)],
    [PLACEMENT_SOUND_HEAVY, createBuffer(context, 0.18, heavyLanding)],
    [PLACEMENT_SOUND_LIGHT, createBuffer(context, 0.12, lightLanding)],
  ]);
}

function createBuffer(context, duration, recipe) {
  const length = Math.max(1, Math.ceil(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  recipe(data, context.sampleRate);
  normalize(data);
  return buffer;
}

function preciseLanding(data, rate) {
  const random = seeded(0x5a8e91c3);
  for (let index = 0; index < data.length; index += 1) {
    const time = index / rate;
    const snap = Math.exp(-time * 72) * (random() * 2 - 1);
    const chime = Math.exp(-time * 48) * Math.sin(2 * Math.PI * (1_850 * time + 420 * time * time));
    const edge = Math.exp(-time * 68) * Math.sin(2 * Math.PI * 2_760 * time);
    data[index] += snap * 0.32 + chime * 0.82 + edge * 0.38;
  }
}

function heavyLanding(data, rate) {
  const random = seeded(0x73a9d51f);
  let smooth = 0;
  for (let index = 0; index < data.length; index += 1) {
    const time = index / rate;
    const envelope = Math.exp(-time * 24);
    smooth = smooth * 0.86 + (random() * 2 - 1) * 0.14;
    const thump = Math.sin(2 * Math.PI * (105 * time - 150 * time * time));
    data[index] += envelope * (thump * 0.85 + smooth * 0.38);
  }
}

function lightLanding(data, rate) {
  const random = seeded(0x2cc31a47);
  for (let index = 0; index < data.length; index += 1) {
    const time = index / rate;
    const envelope = Math.exp(-time * 38);
    const knock = Math.sin(2 * Math.PI * (430 * time - 380 * time * time));
    data[index] += envelope * (knock * 0.72 + (random() * 2 - 1) * 0.16);
  }
}

function normalize(data) {
  let peak = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0.94 ? 0.94 / peak : 1;
  if (scale !== 1) for (let index = 0; index < data.length; index += 1) data[index] *= scale;
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}
