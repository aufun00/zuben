export const GAME_LIST = Object.freeze([
  Object.freeze({ gameID: "match3", durs: Object.freeze([60, 90, 180]), scoreVersion: "dish2" }),
  Object.freeze({ gameID: "stacker", durs: Object.freeze([60, 9_999]) }),
  Object.freeze({ gameID: "runner", durs: Object.freeze([30, 60]) }),
  Object.freeze({ gameID: "2048", durs: Object.freeze([30, 60]) }),
  Object.freeze({ gameID: "linefit", durs: Object.freeze([60, 90]) }),
]);

export function findGame(gameIdx) {
  if (!/^(0|[1-9]\d*)$/.test(gameIdx)) return null;
  const index = Number(gameIdx);
  if (!Number.isSafeInteger(index)) return null;
  return GAME_LIST[index] ?? null;
}
