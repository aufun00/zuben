export const DEADLINE_SETTLEMENT_MS = 400;

export function createGameTime(deadlineGT) {
  if (!Number.isFinite(deadlineGT) || deadlineGT < 0) throw new RangeError("deadlineGT must be nonnegative");

  let startAt = null;
  let pauseAt = null;

  return Object.freeze({
    reset(BN) {
      requireBN(BN);
      startAt = BN;
      pauseAt = null;
    },
    pause(BN) {
      requireBN(BN);
      if (startAt === null || pauseAt !== null) return;
      pauseAt = BN;
    },
    pauseAndJumpTo(BN, targetGT) {
      requireBN(BN);
      if (startAt === null || pauseAt !== null) return;
      const currentGT = BN - startAt;
      const jumpGT = Number.isFinite(targetGT) ? Math.max(0, targetGT - currentGT) : 0;
      pauseAt = BN;
      startAt -= jumpGT;
    },
    resume(BN) {
      requireBN(BN);
      if (startAt === null || pauseAt === null) return;
      startAt += BN - pauseAt;
      pauseAt = null;
    },
    getGT(BN) {
      requireBN(BN);
      if (startAt === null) return null;
      return (pauseAt ?? BN) - startAt;
    },
    getBN(GT) {
      if (startAt === null || pauseAt !== null || !Number.isFinite(GT)) return null;
      return startAt + GT;
    },
    getDeadlineBN() {
      if (startAt === null || pauseAt !== null) return null;
      return startAt + deadlineGT;
    },
  });
}

function requireBN(BN) {
  if (!Number.isFinite(BN)) throw new TypeError("BN must be finite");
}
