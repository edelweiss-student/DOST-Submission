import * as THREE from 'three';
import { mulberry32, range, clamp } from '../shared.js';
import { Builder } from './props.js';
import { patchMaterial, foliageDepthMaterial } from './materials.js';
import { InstanceChunks, fillInstances } from './vegetation.js';
import { leafSprite } from './textures.js';

// The coast of a Philippine island: coconut palms leaning out over the
// beaches, with coconuts to pick (gathering.js), and groves of mangroves
// standing in the shallows on their arching prop roots, which break the
// waves and storm surges before they reach the shore. Both are built here
// in code and placed from the island's own random numbers (rng), so every
// player on an island finds them in the same places.

const UP = new THREE.Vector3(0, 1, 0);

// A palm frond's texture: leaflets either side of a midrib, base at the
// bottom and tip at the top, on a transparent background tinted green (so
// distant mipmaps don't darken at the edges).
function frondSprite(anisotropy) {
  const w = 128, h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(7);
  ctx.fillStyle = 'rgba(70, 135, 50, 0.03)';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < 44; i++) {
    const t = (i + 0.5) / 44;                // base to tip
    const y = h * (1 - t);
    const len = (w / 2 - 4) * Math.sin(Math.PI * Math.min(1, 0.12 + t)) ** 0.6;
    ctx.strokeStyle = `rgb(${55 + rng() * 30}, ${125 + rng() * 45}, ${40 + rng() * 25})`;
    ctx.lineWidth = 3.4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(w / 2, y);
      ctx.quadraticCurveTo(w / 2 + side * len * 0.55, y - 8, w / 2 + side * len, y - 24);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#9a9550';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(w / 2, h);
  ctx.lineTo(w / 2, 0);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

// A small ball (a coconut) on a builder.
function ball(b, c, r, ao) {
  const first = b.pos.length / 3, rows = 5, cols = 7, n = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i <= rows; i++) {
    const v = (i / rows) * Math.PI;
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * Math.PI * 2;
      n.set(Math.sin(v) * Math.cos(u), Math.cos(v), Math.sin(v) * Math.sin(u));
      b.vert(p.copy(c).addScaledVector(n, r), n, j / cols, i / rows, ao);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = first + i * (cols + 1) + j, d = a + cols + 1;
      b.idx.push(a, d, a + 1, a + 1, d, d + 1);
    }
  }
}

// A coconut palm: a slender ringed trunk that leans out along +X and
// curves back up, a crown of drooping fronds, and coconuts under it.
function buildPalm(seed) {
  const rng = mulberry32(seed);
  const trunk = new Builder(), crown = new Builder();
  const H = range(rng, 6.5, 9), lean = range(rng, 0.25, 0.55);
  const points = [], radii = [], n = 26;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push(new THREE.Vector3(H * lean * (t - 0.5 * t * t), H * t, 0));
    radii.push(0.17 - 0.06 * t + 0.08 * Math.max(0, 1 - t * 8));   // a flared foot
  }
  // Leaf scars ring the trunk.
  trunk.tube(points, radii, 7, 2, 1.5, (t) => (Math.round(t * n) % 2 ? 0.78 : 1));
  const top = points[n];
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rng();
    ball(trunk, new THREE.Vector3(top.x + Math.cos(a) * 0.2, top.y - 0.25 - rng() * 0.15, Math.sin(a) * 0.2), 0.12, 0.55);
  }

  const side = new THREE.Vector3(), tan = new THREE.Vector3(), nrm = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const fronds = 13;
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + range(rng, -0.2, 0.2);
    const hx = Math.cos(a), hz = Math.sin(a);
    const L = range(rng, 2.8, 3.7), rise = range(rng, 0.2, 0.75), droop = range(rng, 0.9, 1.5);
    const tone = range(rng, 0.8, 1.05);
    side.set(-hz, 0, hx);
    const first = crown.pos.length / 3, segs = 9;
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      c.set(top.x + hx * L * s, top.y + 0.1 + L * (rise * s - droop * s * s), top.z + hz * L * s);
      tan.set(hx, rise - 2 * droop * s, hz).normalize();
      nrm.crossVectors(tan, side).normalize();
      if (nrm.y < 0) nrm.negate();
      nrm.lerp(UP, 0.4).normalize();
      const width = 0.08 + 0.5 * Math.sin(Math.PI * Math.min(1, 0.1 + s * 0.95)) ** 0.6;
      const ao = tone * (0.65 + 0.35 * s);
      // The leaflets hang down a little either side of the midrib.
      for (const [sign, u] of [[-1, 0], [1, 1]]) {
        p.copy(c).addScaledVector(side, sign * width);
        p.y -= 0.18 * width;
        crown.vert(p, nrm, u, s, ao);
      }
    }
    for (let i = 0; i < segs; i++) {
      const a0 = first + i * 2;
      crown.idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  return { trunk: trunk.build(), crown: crown.build(), height: H };
}

// A mangrove: prop roots arching out from the trunk into the mud, a short
// trunk with a few branches, and a dense dome of leaves.
function buildMangrove(seed) {
  const rng = mulberry32(seed);
  const bark = new Builder(), leaves = new Builder();
  const hub = range(rng, 1.1, 1.5), roots = 7 + Math.floor(rng() * 4);
  for (let k = 0; k < roots; k++) {
    const a = (k / roots) * Math.PI * 2 + range(rng, -0.25, 0.25), R = range(rng, 1.1, 1.9);
    const points = [], radii = [];
    for (let i = 0; i <= 6; i++) {
      const s = i / 6;
      const r = R * s;
      points.push(new THREE.Vector3(Math.cos(a) * r, hub * (1 - s * s) + 0.3 * Math.sin(Math.PI * s) - 0.3 * s, Math.sin(a) * r));
      radii.push(0.06 - 0.025 * s);
    }
    bark.tube(points, radii, 4, 1, 1, (s) => 0.55 + 0.35 * (1 - s));
  }
  const crownY = hub + range(rng, 1.3, 1.7);
  bark.tube([new THREE.Vector3(0, hub * 0.5, 0), new THREE.Vector3(0.05, crownY - 0.4, 0.03)], [0.13, 0.09], 6, 1, 1, () => 0.7);
  for (let k = 0; k < 3; k++) {
    const a = rng() * Math.PI * 2;
    bark.tube([new THREE.Vector3(0.05, crownY - 0.6, 0.03), new THREE.Vector3(Math.cos(a) * 0.9, crownY + 0.2, Math.sin(a) * 0.9)], [0.06, 0.025], 4, 1, 1, () => 0.75);
  }
  // The crown: leaf cards on a dome, normals bent outwards so it shades as one.
  const R = range(rng, 1.6, 2.1), Hc = range(rng, 0.9, 1.2), centre = new THREE.Vector3(0, crownY, 0);
  const out = new THREE.Vector3(), cardN = new THREE.Vector3(), n = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3(), tmp = new THREE.Vector3();
  const normalAt = (q) => n.copy(cardN).lerp(out.set(q.x - centre.x, q.y - centre.y + 0.4, q.z - centre.z).normalize(), 0.75).normalize();
  const aoAt = (q) => clamp(0.35 + 0.65 * Math.hypot((q.x - centre.x) / R, (q.y - centre.y) / Hc, (q.z - centre.z) / R) * clamp((q.y - hub) / (crownY - hub + Hc), 0, 1), 0.3, 1);
  const unit = (v, upBias) => {
    const z = range(rng, -1, 1), a = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    return v.set(r * Math.cos(a), z + upBias, r * Math.sin(a)).normalize();
  };
  for (let k = 0; k < 38; k++) {
    const dir = unit(new THREE.Vector3(), 0.6);
    const q = centre.clone().add(new THREE.Vector3(dir.x * R, dir.y * Hc, dir.z * R).multiplyScalar(range(rng, 0.35, 0.95)));
    unit(cardN, 0.5);
    u.crossVectors(cardN, unit(tmp, 0)).normalize();
    w.crossVectors(cardN, u).normalize();
    const s = range(rng, 0.5, 0.7);
    leaves.card(q, u.clone().multiplyScalar(s), w.clone().multiplyScalar(s), normalAt, aoAt);
  }
  return { bark: bark.build(), leaves: leaves.build() };
}

// Palms along the beaches, leaning out to sea; mangrove groves in the
// shallows. colliders: the vegetation's (palms and mangroves are added to
// it). Returns { palms, mangroves, update(camera), mangroveNear(x, z, d) }.
export function createCoast(scene, terrain, rng, { quality, colliders, cloudShadows }) {
  const shadows = quality.shadowMap > 0;
  const found = [];
  const clear = (x, z, min) => colliders.query(x, z, found).every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > (min + c.r) ** 2);

  // --- Palms: on the sand and just above it, away from other trunks.
  const palms = [];
  for (let k = 0; k < 30000 && palms.length < 200; k++) {
    const x = range(rng, -340, 340), z = range(rng, -340, 340);
    const h = terrain.heightAt(x, z);
    if (h < 0.7 || h > 3.4 || terrain.slopeAt(x, z) > 0.3 || !clear(x, z, 2.5)) continue;
    // Lean towards the sea: down the slope, else out from the middle.
    const gx = terrain.heightAt(x + 2, z) - terrain.heightAt(x - 2, z), gz = terrain.heightAt(x, z + 2) - terrain.heightAt(x, z - 2);
    const out = Math.hypot(gx, gz) > 0.05 ? Math.atan2(-gz, -gx) : Math.atan2(z, x);
    palms.push({ x, y: h - 0.1, z, rot: -(out + range(rng, -0.6, 0.6)), s: range(rng, 0.85, 1.15), sy: 1, variant: Math.floor(rng() * 3) });
    colliders.add(x, z, 0.3);
  }

  // --- Mangroves: groves in the shallows, where the ground is just under the sea.
  const mangroves = [];
  const centres = [];
  for (let k = 0; k < 20000 && centres.length < 7; k++) {
    const x = range(rng, -340, 340), z = range(rng, -340, 340);
    const h = terrain.heightAt(x, z);
    if (h < -0.7 || h > 0.1 || terrain.slopeAt(x, z) > 0.12) continue;
    if (centres.some((c) => Math.hypot(c.x - x, c.z - z) < 90)) continue;
    centres.push({ x, z });
  }
  for (const centre of centres) {
    for (let k = 0, n = 0, want = 10 + Math.floor(rng() * 9); k < 400 && n < want; k++) {
      const x = centre.x + range(rng, -16, 16), z = centre.z + range(rng, -16, 16);
      const h = terrain.heightAt(x, z);
      if (h < -0.95 || h > 0.3 || !clear(x, z, 1.6)) continue;
      mangroves.push({ x, y: h - 0.15, z, rot: rng() * Math.PI * 2, s: range(rng, 0.8, 1.15), sy: range(rng, 0.9, 1.1), variant: Math.floor(rng() * 2), tone: rng() });
      colliders.add(x, z, 0.8);
      n++;
    }
  }

  const tone = new THREE.Color();
  const chunks = [];

  // Palms: three shapes, trunks and crowns swaying together.
  const frondTex = frondSprite(quality.anisotropy);
  const trunkMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, color: '#8f7d64' }),
    { key: 'palm-trunk', sway: 0.5, snowMin: 0.6, cloudShadows });
  const frondMat = patchMaterial(
    new THREE.MeshLambertMaterial({ map: frondTex, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, alphaToCoverage: quality.antialias }),
    { key: 'palm-frond', sway: 0.5, flutter: 1.2, foliage: 0.7, dry: true, snowMin: 0.35, cloudShadows, hardShadow: true },
  );
  const frondDepth = foliageDepthMaterial({ key: 'palm-frond', map: frondTex, alphaTest: 0.5, sway: 0.5, flutter: 1.2 });
  [11, 12, 13].map(buildPalm).forEach((g, vi) => {
    const list = palms.filter((p) => p.variant === vi);
    if (!list.length) return;
    const fill = fillInstances();
    chunks.push(new InstanceChunks(scene, g.trunk, trunkMat, list, { maxDistance: 320, castShadow: shadows, fill }));
    const crowns = new InstanceChunks(scene, g.crown, frondMat, list, { maxDistance: 320, castShadow: shadows, fill });
    for (const m of crowns.chunks) m.customDepthMaterial = frondDepth;
    chunks.push(crowns);
  });

  // Mangroves: two shapes, dark glossy leaves, roots that catch the light under water.
  const leafTex = leafSprite(quality.anisotropy, 5);
  const barkMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, color: '#6b5a4a' }),
    { key: 'mangrove-bark', sway: 0.6, snowMin: 0.6, caustics: true, cloudShadows });
  const leafMat = patchMaterial(
    new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, alphaToCoverage: quality.antialias }),
    { key: 'mangrove-leaves', sway: 0.6, flutter: 0.8, foliage: 0.6, dry: true, snowMin: 0.35, cloudShadows, hardShadow: true },
  );
  const leafDepth = foliageDepthMaterial({ key: 'mangrove-leaves', map: leafTex, alphaTest: 0.45, sway: 0.6, flutter: 0.8 });
  const leafTones = [new THREE.Color(0.55, 0.78, 0.5), new THREE.Color(0.72, 0.9, 0.55)];
  [21, 22].map(buildMangrove).forEach((g, vi) => {
    const list = mangroves.filter((m) => m.variant === vi);
    if (!list.length) return;
    chunks.push(new InstanceChunks(scene, g.bark, barkMat, list, { maxDistance: 260, castShadow: shadows, fill: fillInstances() }));
    const crowns = new InstanceChunks(scene, g.leaves, leafMat, list, {
      maxDistance: 260, castShadow: shadows,
      fill: fillInstances((m) => tone.copy(leafTones[0]).lerp(leafTones[1], m.tone)),
    });
    for (const m of crowns.chunks) m.customDepthMaterial = leafDepth;
    chunks.push(crowns);
  });

  return {
    palms,
    mangroves,
    update(camera) {
      for (const c of chunks) c.update(camera);
    },
    // Whether a mangrove stands within d metres of (x, z).
    mangroveNear(x, z, d) {
      return mangroves.some((m) => (m.x - x) ** 2 + (m.z - z) ** 2 < d * d);
    },
  };
}
