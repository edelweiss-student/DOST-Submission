// Packs the "3D Retro World" tree models into one compact GLB per species
// for the game (public/models/trees/<species>.glb):
// - each variant keeps its full tree ("Birch_A") and its distance
//   billboard ("Birch_A_far"), moved to the origin
// - textures shared between variants are stored once, shrunk to the sizes
//   the game uses (sRGB-correct, alpha-weighted) and re-encoded
// - leaves and billboards become alpha-tested instead of blended
// - wind vertex colours and lightmap UVs are dropped (the game has its own wind)
// Uses only Node built-ins.
//
// Usage: node scripts/import-trees.mjs "<folder with Birch_A.glb, Oak_B.glb, ...>"

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const OUT_DIR = new URL('../public/models/trees/', import.meta.url);

const SPECIES = {
  birch: ['Birch_A', 'Birch_B', 'Birch_C'],
  eucalyptus: ['Eucalyptus_A', 'Eucalyptus_B', 'Eucalyptus_C'],
  mate: ['Mate_A', 'Mate_B', 'Mate_C'],
  oak: ['Oak_A', 'Oak_B', 'Oak_C'],
  deadwood: ['OakBreakA', 'OakBreakB'],
};
// Longest side of each kind of texture in the game.
const TEXTURE_SIZE = { bark: 512, leaves: 1024, billboard: 512 };

const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const KEEP = ['POSITION', 'NORMAL', 'TEXCOORD_0'];

// --- GLB reading

function readGlb(file) {
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

// Accessor data as a tightly packed typed array.
function readAccessor({ json, bin }, index) {
  const a = json.accessors[index];
  const bv = json.bufferViews[a.bufferView];
  const Arr = COMPONENTS[a.componentType], n = WIDTH[a.type], size = n * Arr.BYTES_PER_ELEMENT;
  const stride = bv.byteStride || size, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const bytes = new Uint8Array(a.count * size);
  for (let i = 0; i < a.count; i++) bytes.set(bin.subarray(base + i * stride, base + i * stride + size), i * size);
  return { array: new Arr(bytes.buffer), componentType: a.componentType, type: a.type, count: a.count, normalized: !!a.normalized };
}

function imageBytes({ json, bin }, textureIndex) {
  const image = json.images[json.textures[textureIndex].source];
  const bv = json.bufferViews[image.bufferView];
  return bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
}

// --- PNG decoding and encoding (8-bit RGB / RGBA, not interlaced)

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(png) {
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

function encodePng({ width, height, data, alpha }) {
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

// --- Image processing

const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const toSrgb = (l) => Math.round(Math.min(1, Math.max(0, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)) * 255);

// Box-filter down to maxSide (power-of-two sizes), averaging light in linear
// space and weighting colour by alpha so leaf edges don't darken.
function shrink(img, maxSide) {
  const f = Math.max(1, Math.max(img.width, img.height) / maxSide);
  if (f === 1) return img;
  const w = img.width / f, h = img.height / f, src = img.data, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const o = ((y * f + dy) * img.width + x * f + dx) * 4, al = src[o + 3] / 255;
          r += TO_LINEAR[src[o]] * al; g += TO_LINEAR[src[o + 1]] * al; b += TO_LINEAR[src[o + 2]] * al; a += al;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = toSrgb(r / a); out[o + 1] = toSrgb(g / a); out[o + 2] = toSrgb(b / a); }
      out[o + 3] = Math.round((a / (f * f)) * 255);
    }
  }
  return { ...img, width: w, height: h, data: out };
}

// Average brightness (linear) of the texels that will be drawn.
function brightness({ data }) {
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    sum += 0.2126 * TO_LINEAR[data[i]] + 0.7152 * TO_LINEAR[data[i + 1]] + 0.0722 * TO_LINEAR[data[i + 2]];
    n++;
  }
  return n ? sum / n : 0;
}

// Scale colours so the image's brightness matches target (linear).
function matchBrightness(img, target) {
  const k = Math.min(1.8, Math.max(0.6, target / Math.max(brightness(img), 1e-4)));
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) data[i + c] = toSrgb(TO_LINEAR[data[i + c]] * k);
  }
}

// Spread leaf colour into the transparent texels around the leaves, so the
// GPU's mipmaps don't fade leaf edges towards black.
function bleed(img, passes = 24) {
  const { width: w, height: h, data } = img;
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = data[i * 4 + 3] > 8 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = filled.slice();
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && filled[yy * w + xx]) {
              const j = (yy * w + xx) * 4;
              r += data[j]; g += data[j + 1]; b += data[j + 2]; n++;
            }
          }
        }
        if (n) {
          data[i * 4] = r / n; data[i * 4 + 1] = g / n; data[i * 4 + 2] = b / n;
          next[i] = 1;
          changed = true;
        }
      }
    }
    filled = next;
    if (!changed) break;
  }
}

// --- GLB writing

class GlbWriter {
  constructor() {
    this.json = {
      asset: { version: '2.0', generator: 'Borrowed Time scripts/import-trees.mjs' },
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

  material(name, texture, alpha) {
    const m = { name, doubleSided: true, pbrMetallicRoughness: { baseColorTexture: { index: texture }, metallicFactor: 0, roughnessFactor: 0.9 } };
    if (alpha) { m.alphaMode = 'MASK'; m.alphaCutoff = 0.5; }
    return this.json.materials.push(m) - 1;
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

// --- Packing

const kindOf = (materialName) =>
  /billboard/i.test(materialName) ? 'billboard' : /bark|break/i.test(materialName) ? 'bark' : 'leaves';

function packSpecies(sourceDir, species, variants) {
  const out = new GlbWriter();
  const textures = new Map();   // source image hash -> { texture, kind }
  const materials = new Map();  // texture index -> material index
  let triangles = 0;

  // Billboards were rendered with their own lighting, some much darker than
  // the leaves they stand in for. Match them to the leaf texture.
  const first = readGlb(path.join(sourceDir, `${variants[0]}.glb`));
  const leafMaterial = first.json.materials.find((m) => kindOf(m.name) === 'leaves');
  const leafBrightness = leafMaterial
    ? brightness(shrink(decodePng(imageBytes(first, leafMaterial.pbrMetallicRoughness.baseColorTexture.index)), TEXTURE_SIZE.leaves))
    : 0;

  const materialFor = (glb, sourceMaterial) => {
    const m = glb.json.materials[sourceMaterial];
    const kind = kindOf(m.name);
    const bytes = imageBytes(glb, m.pbrMetallicRoughness.baseColorTexture.index);
    const hash = crypto.createHash('sha1').update(bytes).digest('hex');
    if (!textures.has(hash)) {
      let img = shrink(decodePng(bytes), TEXTURE_SIZE[kind]);
      if (kind === 'billboard' && leafBrightness) matchBrightness(img, leafBrightness);
      if (kind !== 'bark' && img.alpha) bleed(img);
      if (kind === 'bark') img = { ...img, alpha: false };
      textures.set(hash, { texture: out.texture(encodePng(img), `${species}_${kind}_${textures.size}`), kind });
    }
    const { texture } = textures.get(hash);
    if (!materials.has(texture)) materials.set(texture, out.material(`${species}_${kind}_${texture}`, texture, kind !== 'bark'));
    return { material: materials.get(texture), kind };
  };

  for (const variant of variants) {
    const glb = readGlb(path.join(sourceDir, `${variant}.glb`));
    const near = [], far = [];
    for (const mesh of glb.json.meshes) {
      for (const prim of mesh.primitives) {
        const { material, kind } = materialFor(glb, prim.material);
        const attributes = {};
        for (const name of KEEP) {
          if (prim.attributes[name] === undefined) continue;
          const acc = readAccessor(glb, prim.attributes[name]);
          if (name === 'POSITION') {
            acc.min = [0, 1, 2].map((c) => Math.min(...acc.array.filter((_, i) => i % 3 === c)));
            acc.max = [0, 1, 2].map((c) => Math.max(...acc.array.filter((_, i) => i % 3 === c)));
          }
          attributes[name] = out.accessor(acc, 34962);
        }
        const indices = readAccessor(glb, prim.indices);
        triangles += indices.count / 3;
        const primitive = { attributes, indices: out.accessor(indices, 34963), material, mode: 4 };
        if (kind === 'billboard') far.push(primitive);
        else near.push({ primitive, solid: kind === 'bark' });
      }
    }
    // Solid parts first, so leaves behind a trunk fail the depth test.
    near.sort((a, b) => b.solid - a.solid);
    out.node(variant, near.map((p) => p.primitive));
    if (far.length) out.node(`${variant}_far`, far);
  }

  const file = new URL(`${species}.glb`, OUT_DIR);
  const buffer = out.toBuffer();
  fs.writeFileSync(file, buffer);
  const sizes = [...textures.values()].map(({ kind }) => kind).join(', ');
  console.log(`${species}.glb  ${(buffer.length / 1048576).toFixed(2)} MB  ${variants.length} variants, ${triangles} triangles, textures: ${sizes}`);
}

const sourceDir = process.argv[2];
if (!sourceDir || !fs.existsSync(sourceDir)) {
  console.error('Usage: node scripts/import-trees.mjs "<folder with Birch_A.glb, Oak_B.glb, ...>"');
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [species, variants] of Object.entries(SPECIES)) packSpecies(sourceDir, species, variants);
