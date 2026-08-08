import { createGameAudio } from "../common/game-audio.js";
import {
  PLACEMENT_SOUND_HEAVY,
  PLACEMENT_SOUND_LIGHT,
  PLACEMENT_SOUND_PRECISE,
  createPlacementSoundBuffers,
} from "../common/placement-sound.js";
import { OPERATION_LANDING } from "./runtime.js";

export const STACKER_SOUND_PRECISE = PLACEMENT_SOUND_PRECISE;
export const STACKER_SOUND_HEAVY = PLACEMENT_SOUND_HEAVY;
export const STACKER_SOUND_LIGHT = PLACEMENT_SOUND_LIGHT;

export function selectStackerLandSound(retentionBP) {
  if (!Number.isSafeInteger(retentionBP) || retentionBP < 0 || retentionBP > 10_000) throw new RangeError("retentionBP must be from 0 to 10000");
  if (retentionBP >= 9_000) return STACKER_SOUND_PRECISE;
  if (retentionBP >= 6_000) return STACKER_SOUND_HEAVY;
  return STACKER_SOUND_LIGHT;
}

export function createStackerSound({ surface } = {}) {
  const audio = createGameAudio({ surface, masterGain: 0.55, createBuffers: createPlacementSoundBuffers });

  function sync(snapshot) {
    const transition = snapshot?.transition;
    if (snapshot?.operation !== OPERATION_LANDING || transition?.kind !== "land" || !transition.layer) {
      audio.clearPending();
      return;
    }
    audio.play({
      key: `${transition.startGT}:${transition.endGT}`,
      soundID: selectStackerLandSound(transition.layer.retentionBP),
      offsetMS: snapshot.runGT - transition.startGT,
      gain: transition.layer.retentionBP >= 9_000 ? 1 : transition.layer.retentionBP >= 6_000 ? 0.78 : 0.62,
    });
  }

  return Object.freeze({ sync, setVisible: audio.setVisible, destroy: audio.destroy });
}
