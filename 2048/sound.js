import { createGameAudio } from "../common/game-audio.js";
import { UPGRADE_SOUND, createUpgradeSoundBuffers } from "../common/upgrade-sound.js";
import { OPERATION_MOVING } from "./runtime.js";

export function create2048Sound({ surface } = {}) {
  const audio = createGameAudio({ surface, masterGain: 0.5, createBuffers: createUpgradeSoundBuffers });

  function sync(snapshot) {
    const transition = snapshot?.transition;
    if (snapshot?.operation !== OPERATION_MOVING || !transition || transition.mergeCount < 1) {
      audio.clearPending();
      return;
    }
    audio.play({
      key: `${transition.startGT}:${transition.endGT}`,
      soundID: UPGRADE_SOUND,
      offsetMS: snapshot.runGT - transition.startGT,
      gain: 0.82,
    });
  }

  return Object.freeze({ sync, setVisible: audio.setVisible, destroy: audio.destroy });
}
