/*
 * QR Code Model 2 encoder for challenge URLs.
 * Supports UTF-8 byte mode, versions 1-6, and medium error correction.
 * The encoding structure follows ISO/IEC 18004 and Project Nayuki's QR Code
 * generator: https://www.nayuki.io/page/qr-code-generator-library
 *
 * Copyright (c) Project Nayuki. (MIT License)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const MIN_VERSION = 1;
const MAX_VERSION = 6;
const FORMAT_BITS_MEDIUM = 0;
const ECC = Object.freeze([
  null,
  { perBlock: 10, blocks: 1 },
  { perBlock: 16, blocks: 1 },
  { perBlock: 26, blocks: 1 },
  { perBlock: 18, blocks: 2 },
  { perBlock: 24, blocks: 2 },
  { perBlock: 16, blocks: 4 },
]);

export function encodeQr(text) {
  const data = new TextEncoder().encode(String(text));
  let version = MIN_VERSION;
  let dataCodewords;
  for (; version <= MAX_VERSION; version++) {
    const capacity = getDataCodewords(version);
    if (4 + 8 + data.length * 8 <= capacity * 8) {
      dataCodewords = makeDataCodewords(data, capacity);
      break;
    }
  }
  if (!dataCodewords) throw new RangeError("QR payload is too long");

  const qr = new QrCode(version, dataCodewords);
  return Object.freeze({
    size: qr.size,
    version,
    mask: qr.mask,
    getModule: (x, y) => qr.getModule(x, y),
  });
}

export function createQrSvg(text, label = "QR code") {
  const qr = encodeQr(text);
  const border = 4;
  const viewSize = qr.size + border * 2;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${viewSize} ${viewSize}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("shape-rendering", "crispEdges");

  const background = document.createElementNS(svg.namespaceURI, "rect");
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#fff");
  svg.append(background);

  const path = document.createElementNS(svg.namespaceURI, "path");
  let commands = "";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) commands += `M${x + border},${y + border}h1v1h-1z`;
    }
  }
  path.setAttribute("d", commands);
  path.setAttribute("fill", "#000");
  svg.append(path);
  return svg;
}

class QrCode {
  constructor(version, dataCodewords) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = makeGrid(this.size, false);
    this.isFunction = makeGrid(this.size, false);
    this.drawFunctionPatterns();
    this.drawCodewords(this.addEccAndInterleave(dataCodewords));

    let bestMask = 0;
    let bestPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const penalty = this.getPenaltyScore();
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestMask = mask;
      }
      this.applyMask(mask);
    }
    this.mask = bestMask;
    this.applyMask(bestMask);
    this.drawFormatBits(bestMask);
  }

  getModule(x, y) {
    return x >= 0 && y >= 0 && x < this.size && y < this.size && this.modules[y][x];
  }

  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(this.size - 4, 3);
    this.drawFinder(3, this.size - 4);

    const positions = this.getAlignmentPositions();
    for (let i = 0; i < positions.length; i++) {
      for (let j = 0; j < positions.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0)) continue;
        this.drawAlignment(positions[i], positions[j]);
      }
    }
    this.drawFormatBits(0);
  }

  drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < this.size && y < this.size) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          this.setFunction(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawFormatBits(mask) {
    const data = (FORMAT_BITS_MEDIUM << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;

    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunction(this.size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, this.size - 15 + i, bit(bits, i));
    this.setFunction(8, this.size - 8, true);
  }

  setFunction(x, y, dark) {
    this.modules[y][x] = Boolean(dark);
    this.isFunction[y][x] = true;
  }

  getAlignmentPositions() {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const result = [6];
    for (let position = this.size - 7; result.length < count; position -= step) result.splice(1, 0, position);
    return result;
  }

  addEccAndInterleave(data) {
    const { perBlock, blocks: blockCount } = ECC[this.version];
    const rawCodewords = Math.floor(getRawDataModules(this.version) / 8);
    const shortBlockCount = blockCount - rawCodewords % blockCount;
    const shortBlockLength = Math.floor(rawCodewords / blockCount);
    const divisor = reedSolomonDivisor(perBlock);
    const blocks = [];

    for (let i = 0, offset = 0; i < blockCount; i++) {
      const length = shortBlockLength - perBlock + (i < shortBlockCount ? 0 : 1);
      const block = data.slice(offset, offset + length);
      offset += length;
      const errorCorrection = reedSolomonRemainder(block, divisor);
      if (i < shortBlockCount) block.push(0);
      blocks.push(block.concat(errorCorrection));
    }

    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        if (i !== shortBlockLength - perBlock || j >= shortBlockCount) result.push(blocks[j][i]);
      }
    }
    return result;
  }

  drawCodewords(data) {
    let index = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let column = 0; column < 2; column++) {
          const x = right - column;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.isFunction[y][x] && index < data.length * 8) {
            this.modules[y][x] = bit(data[index >>> 3], 7 - (index & 7));
            index++;
          }
        }
      }
    }
    if (index !== data.length * 8) throw new Error("QR data placement failed");
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && maskCondition(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  getPenaltyScore() {
    let score = 0;
    for (const row of this.modules) score += linePenalty(row);
    for (let x = 0; x < this.size; x++) score += linePenalty(this.modules.map((row) => row[x]));

    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const value = this.modules[y][x];
        if (value === this.modules[y][x + 1] && value === this.modules[y + 1][x] && value === this.modules[y + 1][x + 1]) score += 3;
      }
    }

    const dark = this.modules.flat().filter(Boolean).length;
    score += Math.floor(Math.abs(dark * 20 - this.size * this.size * 10) / (this.size * this.size)) * 10;
    return score;
  }
}

function makeDataCodewords(bytes, capacity) {
  const bits = [];
  appendBits(0b0100, 4, bits);
  appendBits(bytes.length, 8, bits);
  for (const value of bytes) appendBits(value, 8, bits);
  appendBits(0, Math.min(4, capacity * 8 - bits.length), bits);
  appendBits(0, (8 - bits.length % 8) % 8, bits);
  for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11) appendBits(pad, 8, bits);

  const result = Array(capacity).fill(0);
  bits.forEach((value, index) => { result[index >>> 3] |= value << (7 - (index & 7)); });
  return result;
}

function getDataCodewords(version) {
  const { perBlock, blocks } = ECC[version];
  return Math.floor(getRawDataModules(version) / 8) - perBlock * blocks;
}

function getRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
  }
  return result;
}

function reedSolomonDivisor(degree) {
  const result = Array(degree - 1).fill(0).concat(1);
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 2);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const value of data) {
    const factor = value ^ result.shift();
    result.push(0);
    divisor.forEach((coefficient, index) => { result[index] ^= reedSolomonMultiply(coefficient, factor); });
  }
  return result;
}

function reedSolomonMultiply(x, y) {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((y >>> i) & 1) * x;
  }
  return result;
}

function linePenalty(line) {
  let score = 0;
  let runLength = 1;
  for (let i = 1; i < line.length; i++) {
    if (line[i] === line[i - 1]) {
      runLength++;
      if (runLength === 5) score += 3;
      else if (runLength > 5) score++;
    } else runLength = 1;
  }
  const pattern = "1011101";
  const string = line.map((value) => value ? "1" : "0").join("");
  for (let i = 0; i <= string.length - 11; i++) {
    const chunk = string.slice(i, i + 11);
    if (chunk === `0000${pattern}` || chunk === `${pattern}0000`) score += 40;
  }
  return score;
}

function maskCondition(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return x * y % 2 + x * y % 3 === 0;
    case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
    case 7: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    default: throw new RangeError("Invalid QR mask");
  }
}

function appendBits(value, length, target) {
  for (let i = length - 1; i >= 0; i--) target.push((value >>> i) & 1);
}

function bit(value, index) { return ((value >>> index) & 1) !== 0; }

function makeGrid(size, value) {
  return Array.from({ length: size }, () => Array(size).fill(value));
}
