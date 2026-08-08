import { createGameAudio } from "../common/game-audio.js";
import {
  PLACEMENT_SOUND_LIGHT,
  PLACEMENT_SOUND_PRECISE,
  createPlacementSoundBuffers,
} from "../common/placement-sound.js";

export const LINEFIT_SOUND_CLEAR = PLACEMENT_SOUND_PRECISE;
export const LINEFIT_SOUND_PLACE = PLACEMENT_SOUND_LIGHT;

export function selectLineFitPlacementSound(clearCount) {
  if (!Number.isSafeInteger(clearCount) || clearCount < 0) throw new RangeError("clearCount must be a nonnegative safe integer");
  return clearCount > 0 ? LINEFIT_SOUND_CLEAR : LINEFIT_SOUND_PLACE;
}

export function createLineFitSound({ surface } = {}) {
  const audio = createGameAudio({ surface, masterGain: 0.55, createBuffers: createPlacementSoundBuffers });

  function sync(snapshot) {
    const placement = snapshot?.lastPlacement;
    if (!placement) {
      audio.clearPending();
      return;
    }
    audio.play({
      key: `placement:${placement.count}`,
      soundID: selectLineFitPlacementSound(placement.clearCount),
      offsetMS: snapshot.runGT - placement.actionGT,
      gain: placement.clearCount > 0 ? 1 : 0.62,
    });
  }

  return Object.freeze({ sync, setVisible: audio.setVisible, destroy: audio.destroy });
}
