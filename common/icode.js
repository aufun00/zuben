const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CODE_RE = /^[A-Za-z0-9_-]{10}$/;

export function generateICode(durIdx) {
  if (!Number.isInteger(durIdx) || durIdx < 0 || durIdx > 3) {
    throw new RangeError("durIdx must be an integer from 0 to 3");
  }

  const seed = new Uint8Array(6);
  crypto.getRandomValues(seed);
  const dataBits = (BigInt(durIdx) << 48n) | bytesToBigInt(seed);
  const check = crc6(dataBits, 50);
  const payload = (dataBits << 6n) | BigInt(check);
  const code = encode56(payload);

  if (!parseICode(code).ok) throw new Error("Generated invalid iCode");
  return code;
}

export function parseICode(code) {
  if (typeof code !== "string" || !CODE_RE.test(code)) return { ok: false };
  const payload = decode56(code);
  if (payload === null || encode56(payload) !== code) return { ok: false };

  const receivedCheck = Number(payload & 0x3fn);
  const dataBits = payload >> 6n;
  if (crc6(dataBits, 50) !== receivedCheck) return { ok: false };

  const durIdx = Number(dataBits >> 48n);
  const seedValue = dataBits & 0xffffffffffffn;
  return { ok: true, durIdx, seed: bigIntToBytes(seedValue, 6) };
}

function crc6(value, bitCount) {
  let crc = 0;
  for (let bit = bitCount - 1; bit >= 0; bit -= 1) {
    const input = Number((value >> BigInt(bit)) & 1n);
    const feedback = ((crc >> 5) & 1) ^ input;
    crc = (crc << 1) & 0x3f;
    if (feedback) crc ^= 0x03;
  }
  return crc;
}

function encode56(value) {
  let output = "";
  for (let shift = 50; shift >= 2; shift -= 6) {
    output += ALPHABET[Number((value >> BigInt(shift)) & 0x3fn)];
  }
  output += ALPHABET[Number(value & 0x03n) << 4];
  return output;
}

function decode56(code) {
  let value = 0n;
  for (let index = 0; index < 9; index += 1) {
    const digit = ALPHABET.indexOf(code[index]);
    if (digit < 0) return null;
    value = (value << 6n) | BigInt(digit);
  }
  const finalDigit = ALPHABET.indexOf(code[9]);
  if (finalDigit < 0 || (finalDigit & 0x0f) !== 0) return null;
  return (value << 2n) | BigInt(finalDigit >> 4);
}

function bytesToBigInt(bytes) {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function bigIntToBytes(value, length) {
  const bytes = new Uint8Array(length);
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}
