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
import crypto from 'node:crypto';
import { readGlb, readAccessor, imageBytes, decodePng, encodePng, TO_LINEAR, toSrgb, GlbWriter } from './gltf.mjs';

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

const KEEP = ['POSITION', 'NORMAL', 'TEXCOORD_0'];

// --- Image processing

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

// --- Packing

const kindOf = (materialName) =>
  /billboard/i.test(materialName) ? 'billboard' : /bark|break/i.test(materialName) ? 'bark' : 'leaves';

function packSpecies(sourceDir, species, variants) {
  const out = new GlbWriter('Borrowed Time scripts/import-trees.mjs');
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
    if (!materials.has(texture)) {
      const material = {
        name: `${species}_${kind}_${texture}`, doubleSided: true,
        pbrMetallicRoughness: { baseColorTexture: { index: texture }, metallicFactor: 0, roughnessFactor: 0.9 },
      };
      if (kind !== 'bark') { material.alphaMode = 'MASK'; material.alphaCutoff = 0.5; }
      materials.set(texture, out.material(material));
    }
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
