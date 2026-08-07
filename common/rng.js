const MASK_64 = 0xffffffffffffffffn;
const MULTIPLIER = 6364136223846793005n;
const INCREMENT = 1442695040888963407n;

export function createLogicRng(seed, restoredState = null) {
  if (!(seed instanceof Uint8Array) || seed.length !== 6) {
    throw new TypeError("seed must be a 6-byte Uint8Array");
  }

  let seedValue = 0n;
  for (const byte of seed) seedValue = (seedValue << 8n) | BigInt(byte);

  let state = 0n;

  function nextUint32Internal() {
    const oldState = state;
    state = (oldState * MULTIPLIER + INCREMENT) & MASK_64;

    const xorshifted = Number((((oldState >> 18n) ^ oldState) >> 27n) & 0xffffffffn);
    const rotation = Number(oldState >> 59n);
    return ((xorshifted >>> rotation) | (xorshifted << ((-rotation) & 31))) >>> 0;
  }

  if (restoredState === null) {
    nextUint32Internal();
    state = (state + seedValue) & MASK_64;
    nextUint32Internal();
  } else {
    if (typeof restoredState !== "string" || !/^[0-9a-f]{16}$/i.test(restoredState)) throw new TypeError("RNG state must be 16 hexadecimal digits");
    state = BigInt(`0x${restoredState}`);
  }

  return Object.freeze({
    nextUint32: nextUint32Internal,
    exportState: () => state.toString(16).padStart(16, "0"),
  });
}
