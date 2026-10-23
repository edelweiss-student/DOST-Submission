// Packs the knife, axe and pickaxe from Kay Lousberg's "KayKit : RPG Tools
// Bits" (CC0, https://kaylousberg.itch.io/rpg-tools-bits) into one small GLB
// for the game (public/models/tools.glb):
// - the colours each model takes from the pack's palette texture are baked
//   into its vertices, so the tools share the items' one material and the
//   texture isn't needed
// - the game's tools are stone-headed, so their metal becomes stone
// - each stands on its grip at the origin, handle up +Y and head towards
//   +X, scaled to the game's size
// Uses only Node built-ins.
//
// Usage: node scripts/import-tools.mjs "<the pack's Assets/gltf folder>"

import fs from 'node:fs';
import path from 'node:path';
import { readGltf, readAccessor, decodePng, TO_LINEAR, GlbWriter } from './gltf.mjs';

const OUT = new URL('../public/models/tools.glb', import.meta.url);

// The model each game tool uses, and its length from grip to tip (m).
const TOOLS = {
  knife: { model: 'knife', length: 0.3 },
  axe: { model: 'axe', length: 0.55 },
  pickaxe: { model: 'pickaxe', length: 0.62 },
};
// Metal becomes stone: dark to light along the same gradient (sRGB).
const STONE = [[0x5f, 0x5c, 0x57], [0xb9, 0xb4, 0xab]];

// Greys and blue-greys are metal; browns (and anything warmer) are wood or leather.
const isMetal = (r, g, b) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max - min < 0.3 * Math.max(max, 1) && b >= r - 8;
};

function packTool(dir, palette, out, name, { model, length }) {
  const gltf = readGltf(path.join(dir, `${model}.gltf`));
  const prim = gltf.json.meshes[0].primitives[0];
  const pos = Float32Array.from(readAccessor(gltf, prim.attributes.POSITION).array);
  const nrm = Float32Array.from(readAccessor(gltf, prim.attributes.NORMAL).array);
  const uv = readAccessor(gltf, prim.attributes.TEXCOORD_0).array;
  const indices = readAccessor(gltf, prim.indices);
  const n = pos.length / 3;

  // Each vertex's colour from the palette (glTF UVs start at the top left).
  const color = new Float32Array(n * 3), metal = new Uint8Array(n);
  const { width: W, height: H, data } = palette;
  for (let i = 0; i < n; i++) {
    const x = Math.min(W - 1, Math.max(0, Math.floor(uv[i * 2] * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(uv[i * 2 + 1] * H)));
    let rgb = [...data.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)];
    if (isMetal(...rgb)) {
      metal[i] = 1;
      const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      rgb = STONE[0].map((c, k) => Math.round(c + (STONE[1][k] - c) * lum));
    }
    for (let k = 0; k < 3; k++) color[i * 3 + k] = TO_LINEAR[rgb[k]];
  }

  // Which way it faces: the head (metal) at the top, pointing along +X.
  const mean = (axis, pick) => {
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) if (pick(i)) { sum += pos[i * 3 + axis]; count++; }
    return count ? sum / count : 0;
  };
  const turned = [];
  const flip = (a, b) => { for (const arr of [pos, nrm]) for (let i = 0; i < n; i++) { arr[i * 3 + a] *= -1; arr[i * 3 + b] *= -1; } };
  if (mean(1, (i) => metal[i]) < mean(1, (i) => !metal[i])) { flip(1, 2); turned.push('head up'); }
  // The grip: the bottom tenth of the tool, centred on the origin.
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minY = Math.min(minY, pos[i * 3 + 1]); maxY = Math.max(maxY, pos[i * 3 + 1]); }
  const grip = (i) => pos[i * 3 + 1] < minY + (maxY - minY) * 0.1;
  const gx = mean(0, grip), gz = mean(2, grip);
  if (mean(0, (i) => metal[i]) < gx) { flip(0, 2); turned.push('head to +X'); }
  const cx = mean(0, grip), cz = mean(2, grip), s = length / (maxY - minY);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (pos[i * 3] - cx) * s;
    pos[i * 3 + 1] = (pos[i * 3 + 1] - minY) * s;
    pos[i * 3 + 2] = (pos[i * 3 + 2] - cz) * s;
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i * 3 + k]); hi[k] = Math.max(hi[k], pos[i * 3 + k]); }
  }

  const vec3 = (array) => ({ array, componentType: 5126, count: n, type: 'VEC3' });
  out.node(name, [{
    attributes: {
      POSITION: out.accessor({ ...vec3(pos), min: lo, max: hi }, 34962),
      NORMAL: out.accessor(vec3(nrm), 34962),
      COLOR_0: out.accessor(vec3(color), 34962),
    },
    indices: out.accessor(indices, 34963),
    material: 0,
    mode: 4,
  }]);
  const size = hi.map((v, k) => (v - lo[k]).toFixed(2)).join(' x ');
  console.log(`${name.padEnd(8)} from ${model}.gltf: ${indices.count / 3} triangles, ${Math.round((metal.reduce((a, b) => a + b) / n) * 100)}% stone, ${size} m${turned.length ? `, turned ${turned.join(', ')}` : ''}`);
}

const dir = process.argv[2];
if (!dir || !fs.existsSync(path.join(dir, 'axe.gltf'))) {
  console.error('Usage: node scripts/import-tools.mjs "<the KayKit RPG Tools Bits Assets/gltf folder>"');
  process.exit(1);
}
const palette = decodePng(fs.readFileSync(path.join(dir, 'tools_bits_texture.png')));
const out = new GlbWriter('Washed Away scripts/import-tools.mjs');
out.material({ name: 'tools', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.9 } });
for (const [name, tool] of Object.entries(TOOLS)) packTool(dir, palette, out, name, tool);
const buffer = out.toBuffer();
fs.writeFileSync(OUT, buffer);
console.log(`tools.glb  ${(buffer.length / 1024).toFixed(1)} KB`);
