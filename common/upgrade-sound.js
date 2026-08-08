export const UPGRADE_SOUND = "upgrade";

export function createUpgradeSoundBuffers(context) {
  const duration = 0.18;
  const length = Math.max(1, Math.ceil(context.sampleRate * duration));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const notes = [
    [0, 523.25, 0.72],
    [0.055, 659.25, 0.78],
    [0.11, 783.99, 0.88],
  ];
  for (const [start, frequency, amplitude] of notes) addNote(data, context.sampleRate, start, frequency, amplitude);
  normalize(data);
  return new Map([[UPGRADE_SOUND, buffer]]);
}

function addNote(data, rate, start, frequency, amplitude) {
  const first = Math.floor(start * rate);
  for (let index = first; index < data.length; index += 1) {
    const time = (index - first) / rate;
    const attack = Math.min(1, time / 0.003);
    const envelope = attack * Math.exp(-time * 24);
    if (envelope < 0.001 && time > 0.02) break;
    const phase = 2 * Math.PI * frequency * time;
    const tone = Math.sin(phase) + Math.sin(phase * 2) * 0.28 + Math.sin(phase * 3) * 0.12;
    data[index] += tone * envelope * amplitude;
  }
}

function normalize(data) {
  let peak = 0;
  for (const value of data) peak = Math.max(peak, Math.abs(value));
  const scale = peak > 0.94 ? 0.94 / peak : 1;
  if (scale !== 1) for (let index = 0; index < data.length; index += 1) data[index] *= scale;
}
