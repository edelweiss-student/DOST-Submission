// glTF and PNG helpers shared by the model import scripts. Node built-ins only.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
export const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

// --- Reading

export function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} is not a GLB file`);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  return { json, bin };
}

// A .gltf file with its one buffer in a .bin file next to it.
export function readGltf(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bin = fs.readFileSync(path.join(path.dirname(file), json.buffers[0].uri));
  return { json, bin };
}

// Accessor data as a tightly packed typed array.
export function readAccessor({ json, bin }, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const Arr = COMPONENTS[a.componentType], n = WIDTH[a.type], size = n * Arr.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || size, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const bytes = new Uint8Array(a.count * size);
  for (let i = 0; i < a.count; i++) bytes.set(bin.subarray(base + i * stride, base + i * stride + size), i * size);
  return { array: new Arr(bytes.buffer), componentType: a.componentType, type: a.type, count: a.count, normalized: !!a.normalized };
}

// An image embedded in a GLB.
export function imageBytes({ json, bin }, textureIndex) {
  const image = json.images[json.textures[textureIndex].source];
  const bv = json.bufferViews[image.bufferView];
  return bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
}

// --- PNG decoding and encoding (8-bit RGB / RGBA, not interlaced)

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(png) {
  let off = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), kind = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace) {
    throw new Error(`unsupported PNG (bit depth ${depth}, colour type ${type}, interlace ${interlace})`);
  }
  const bpp = type === 6 ? 4 : 3, rowLen = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(rowLen), cur = new Uint8Array(rowLen);
  for (let y = 0; y < height; y++) {
    const start = y * (rowLen + 1), filter = raw[start];
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const v = raw[start + 1 + i];
      cur[i] = v + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0);
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * bpp;
      rgba[o] = cur[s]; rgba[o + 1] = cur[s + 1]; rgba[o + 2] = cur[s + 2];
      rgba[o + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    [prev, cur] = [cur, prev];
  }
  return { width, height, data: rgba, alpha: type === 6 };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodePng({ width, height, data, alpha }) {
  const bpp = alpha ? 4 : 3, rowLen = width * bpp;
  const raw = Buffer.alloc((rowLen + 1) * height);
  let prev = new Uint8Array(rowLen), cur = new Uint8Array(rowLen);
  const tries = Array.from({ length: 5 }, () => new Uint8Array(rowLen));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < bpp; c++) cur[x * bpp + c] = data[(y * width + x) * 4 + c];
    }
    // Pick the row filter that leaves the smallest differences.
    let best = 0, bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = tries[f];
      let score = 0;
      for (let i = 0; i < rowLen; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        const p = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0;
        const v = (cur[i] - p) & 255;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; best = f; }
    }
    raw[y * (rowLen + 1)] = best;
    raw.set(tries[best], y * (rowLen + 1) + 1);
    [prev, cur] = [cur, prev];
  }
  const chunk = (type, body) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const head = Buffer.alloc(4), tail = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    tail.writeUInt32BE(crc32(typed));
    return Buffer.concat([head, typed, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Colour

export const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
export const toSrgb = (l) => Math.round(Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)) * 255);

// --- GLB writing

export class GlbWriter {
  constructor(generator) {
    this.json = {
      asset: { version: '2.0', generator },
      scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [],
      samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
      accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
    };
    this.parts = [];
    this.length = 0;
  }

  view(bytes, target) {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.parts.push(Buffer.alloc(pad)); this.length += pad; }
    const bv = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength };
    if (target) bv.target = target;
    this.parts.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    this.length += bytes.byteLength;
    return this.json.bufferViews.push(bv) - 1;
  }

  accessor(acc, target) {
    const a = { bufferView: this.view(acc.array, target), componentType: acc.componentType, count: acc.count, type: acc.type };
    if (acc.normalized) a.normalized = true;
    if (acc.min) { a.min = acc.min; a.max = acc.max; }
    return this.json.accessors.push(a) - 1;
  }

  texture(png, name) {
    this.json.images.push({ name, bufferView: this.view(png), mimeType: 'image/png' });
    return this.json.textures.push({ sampler: 0, source: this.json.images.length - 1 }) - 1;
  }

  // material: a glTF material, as is.
  material(material) {
    return this.json.materials.push(material) - 1;
  }

  node(name, primitives) {
    const mesh = this.json.meshes.push({ name, primitives }) - 1;
    this.json.scenes[0].nodes.push(this.json.nodes.push({ name, mesh }) - 1);
  }

  toBuffer() {
    this.json.buffers[0].byteLength = this.length;
    let json = Buffer.from(JSON.stringify(this.json), 'utf8');
    json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
    let bin = Buffer.concat(this.parts);
    bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
    const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + json.length + bin.length, 8);
    jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
    bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([head, jh, json, bh, bin]);
  }
}
