import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, range, clamp, smoothstep } from '../shared.js';

// Procedural plant and rock geometry. A tree has three parts:
// - bark: tapered tubes for trunk and branches. Trunks reach a metre into
//   the ground and flare at the base, so they meet any slope.
// - crown: a small, dark, opaque core deep inside the crown, so you can't
//   see straight through the middle of a tree.
// - leaves: alpha-tested cards of leaves or needle sprays filling the
//   crown, which give it its leafy look and outline.
// Leaf and core normals point outwards from the crown, so a crown shades as
// one soft volume. Vertex colour carries ambient occlusion (darker inside
// and under the crown).

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _corner = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const CORNERS = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
const MASS_TILE = 1.4;   // metres covered by one repeat of the crown-core texture

class Builder {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.idx = [];
  }
  vert(p, n, u, v, ao) {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(ao, ao, ao);
    return this.pos.length / 3 - 1;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  // A tapered tube along a polyline. uRepeat: texture repeats around it;
  // vScale: repeats per metre along it. ao(t, point) gives occlusion along
  // it (t from 0 at the first point to 1 at the last).
  tube(points, radii, sides, uRepeat, vScale, ao) {
    const n = points.length;
    const normal = new THREE.Vector3(), binormal = new THREE.Vector3(), t = new THREE.Vector3();
    const dir = new THREE.Vector3(), p = new THREE.Vector3();
    let along = 0, first = this.pos.length / 3;
    for (let i = 0; i < n; i++) {
      if (i < n - 1) t.subVectors(points[i + 1], points[i]).normalize();
      else t.subVectors(points[i], points[i - 1]).normalize();
      if (i === 0) {
        normal.copy(Math.abs(t.y) < 0.9 ? UP : _a.set(1, 0, 0)).cross(t).normalize();
      } else {
        along += points[i].distanceTo(points[i - 1]);
        normal.addScaledVector(t, -normal.dot(t)).normalize(); // parallel transport
      }
      binormal.crossVectors(t, normal);
      const occl = ao(i / (n - 1), points[i]);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        dir.copy(normal).multiplyScalar(Math.cos(a)).addScaledVector(binormal, Math.sin(a));
        p.copy(points[i]).addScaledVector(dir, radii[i]);
        this.vert(p, dir, (s / sides) * uRepeat, along * vScale, occl);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = first + i * (sides + 1) + s, b = a + sides + 1;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  // A surface of revolution around axis(y): profile is [{ y, r }] from the
  // bottom up. Faces outwards.
  lathe(axis, profile, sides, uRepeat, vScale, nfn, aofn) {
    const first = this.pos.length / 3;
    const c = new THREE.Vector3(), p = new THREE.Vector3();
    for (const { y, r } of profile) {
      axis(y, c);
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        p.set(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r);
        this.vert(p, nfn(p), (s / sides) * uRepeat, y * vScale, aofn(p));
      }
    }
    for (let i = 0; i < profile.length - 1; i++) {
      for (let s = 0; s < sides; s++) {
        const a = first + i * (sides + 1) + s, b = a + sides + 1;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  // A lumpy ellipsoid around c, faces outwards. bump(dir) scales the radius
  // in each direction.
  blob(c, rx, ry, rz, segW, segH, nfn, aofn, bump) {
    const first = this.pos.length / 3;
    const p = new THREE.Vector3(), d = new THREE.Vector3();
    const uRep = Math.max(2, Math.round((Math.PI * (rx + rz)) / MASS_TILE));
    const vRep = Math.max(1, Math.round((Math.PI * ry) / MASS_TILE));
    for (let j = 0; j <= segH; j++) {
      const th = (j / segH) * Math.PI;
      for (let i = 0; i <= segW; i++) {
        const ph = (i / segW) * Math.PI * 2;
        d.set(Math.sin(th) * Math.cos(ph), -Math.cos(th), Math.sin(th) * Math.sin(ph));
        const k = bump(d);
        p.set(c.x + d.x * rx * k, c.y + d.y * ry * k, c.z + d.z * rz * k);
        this.vert(p, nfn(p), (i / segW) * uRep, (j / segH) * vRep, aofn(p));
      }
    }
    for (let j = 0; j < segH; j++) {
      for (let i = 0; i < segW; i++) {
        const a = first + j * (segW + 1) + i, b = a + segW + 1;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  // A card centred on c, spanning +-ux along u and +-vy along v. Normals come
  // from nfn(position) so they can bend with the crown.
  card(c, ux, vy, nfn, aofn) {
    const first = this.pos.length / 3;
    for (const [su, sv, u, v] of CORNERS) {
      _corner.copy(c).addScaledVector(ux, su).addScaledVector(vy, sv);
      this.vert(_corner, nfn(_corner), u, v, aofn(_corner));
    }
    this.idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
}

// Every other leaf card of a Builder-made leaves geometry (cards are
// consecutive quads). Used as a cheaper stand-in in the shadow map, where
// the lower layers of a crown are hidden by the upper ones anyway.
export function thinCards(geometry, keep = 2) {
  const src = geometry.index.array;
  const idx = [];
  for (let c = 0; c < src.length / 6; c += keep) {
    for (let k = 0; k < 6; k++) idx.push(src[c * 6 + k]);
  }
  const g = geometry.clone();
  g.setIndex(idx);
  return g;
}

function randomUnit(rng, out, upBias = 0) {
  const z = range(rng, -1, 1), a = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z + upBias, r * Math.sin(a)).normalize();
}

// Bends a card normal towards the outward crown direction.
function bentNormal(cardN, outward, amount, out) {
  return out.copy(cardN).lerp(outward, amount).normalize();
}

// Trunk rings from a metre underground (so the trunk meets any slope) up
// through a flared root collar: [height, radius as a multiple of r0]. The
// radius only ever grows downwards, so no edge shows where the ground dips.
const ROOT_FLARE = [[-1, 1.75], [-0.2, 1.65], [0.25, 1.32], [0.9, 1.1]];
// Bark darkens where it meets the soil, so trunks sit in the ground.
const trunkAO = (top) => (t, p) => (p.y < 0.9 ? 0.38 + 0.37 * smoothstep(-0.2, 0.9, p.y) : top(t));

// A spruce/fir: straight trunk, close whorls of branches clothed in fans
// of needle sprays around a small dark core, narrowing to a point.
export function buildConifer(seed, height = 13) {
  const rng = mulberry32(seed);
  const bark = new Builder(), leaves = new Builder(), crown = new Builder();
  const H = height * range(rng, 0.9, 1.1);
  const r0 = 0.2 + H * 0.013;
  const lean = new THREE.Vector2(range(rng, -0.25, 0.25), range(rng, -0.25, 0.25));
  const trunkAt = (y, out) => {
    const t = Math.max(y, 0) / H;
    return out.set(lean.x * t * t, y, lean.y * t * t);
  };
  const trunk = [], radii = [];
  for (const [y, r] of ROOT_FLARE) {
    trunk.push(trunkAt(y, new THREE.Vector3()));
    radii.push(r0 * r * 0.92);
  }
  for (let i = 1; i <= 7; i++) {
    const t = i / 7;
    trunk.push(trunkAt(0.9 + t * (H - 0.9), new THREE.Vector3()));
    radii.push(r0 * (1 - 0.94 * t));
  }
  bark.tube(trunk, radii, 8, 2, 0.45, trunkAO((t) => 0.75 + 0.25 * t));

  const crownBase = H * range(rng, 0.1, 0.18);
  const maxL = H * 0.25;
  const crownR = (t) => maxL * Math.pow(1 - t, 0.9) + 0.35;
  const n = new THREE.Vector3(), out = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
  const cardN = new THREE.Vector3(), base = new THREE.Vector3(), fan = new THREE.Vector3();
  const outward = (p) => {
    trunkAt(p.y, base);
    out.set(p.x - base.x, 0, p.z - base.z);
    if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
    return out.normalize().multiplyScalar(0.85).add(_c.set(0, 0.55, 0)).normalize();
  };
  const normalAt = (p) => bentNormal(cardN, outward(p), 0.7, n);
  const aoAt = (p) => {
    const t = clamp((p.y - crownBase) / (H - crownBase), 0, 1);
    trunkAt(p.y, base);
    const radial = Math.hypot(p.x - base.x, p.z - base.z) / (crownR(t) + 0.2);
    return clamp(0.32 + 0.68 * Math.pow(clamp(radial, 0, 1), 0.8) * (0.6 + 0.4 * t) + 0.08 * t, 0.25, 1);
  };

  // Small dark core around the trunk, deep inside the sprays: it only
  // stops you seeing straight through the middle of the tree.
  const core = 0.36, yb = crownBase + 0.3, yt = H - 0.6;
  const profile = [{ y: yb - 0.3, r: 0.05 }];
  for (let i = 0; i <= 6; i++) {
    const y = yb + (yt - yb) * (i / 6);
    profile.push({ y, r: crownR((y - crownBase) / (H - crownBase)) * core });
  }
  profile.push({ y: H - 0.25, r: 0.04 });
  const around = Math.max(2, Math.round((2 * Math.PI * crownR(0) * core) / MASS_TILE));
  crown.lathe(trunkAt, profile, 10, around, 1 / MASS_TILE, (p) => outward(p), (p) => aoAt(p) * 0.6);

  let y = crownBase, whorl = 0;
  while (y < H - 0.6) {
    const t = (y - crownBase) / (H - crownBase);
    const count = t > 0.85 ? 4 : t > 0.65 ? 5 : 6 + Math.floor(rng() * 2);
    const L = crownR(t) * range(rng, 0.85, 1.1);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + whorl * 2.4 + range(rng, -0.25, 0.25);
      const droop = -0.2 + 0.42 * t + range(rng, -0.08, 0.08);
      const d = new THREE.Vector3(Math.cos(a), droop, Math.sin(a)).normalize();
      const start = trunkAt(y, new THREE.Vector3());
      const mid = start.clone().addScaledVector(d, L * 0.5).add(_a.set(0, -0.05 * L * (1 - t), 0));
      const end = start.clone().addScaledVector(d, L).add(_a.set(0, -0.14 * L * (1 - t), 0));
      const rb = 0.03 + 0.018 * L;
      bark.tube([start, mid, end], [rb, rb * 0.55, rb * 0.15], 3, 1, 1, () => 0.55 + 0.3 * t);
      const along = (f) => (f < 0.5 ? start.clone().lerp(mid, f * 2) : mid.clone().lerp(end, Math.min(1, (f - 0.5) * 2)));
      // Needle sprays from near the trunk to the tip, widening into a fan
      // towards the tip like a real spruce branch, rolled at random so the
      // crown looks full from any side, with crossing sprays for depth.
      const cards = Math.max(2, Math.ceil(L / 0.7));
      const len = Math.min(0.85, L * 0.3 + 0.32);
      tan.subVectors(end, start).normalize();
      for (let c = 0; c < cards; c++) {
        const f = 0.15 + 0.85 * ((c + 0.75) / cards);
        const p = along(f);
        side.crossVectors(UP, tan).normalize();
        side.applyAxisAngle(tan, range(rng, -0.8, 0.8));
        cardN.crossVectors(tan, side).normalize();
        if (cardN.y < 0) cardN.negate();
        const w = (0.3 + 0.28 * f) * (1 - 0.25 * t);
        leaves.card(p, _b.copy(tan).multiplyScalar(len), side.clone().multiplyScalar(w), normalAt, aoAt);
        if (c === cards - 1 || rng() < 0.25) {
          const side2 = side.clone().applyAxisAngle(tan, Math.PI / 2 + range(rng, -0.3, 0.3));
          cardN.crossVectors(tan, side2).normalize();
          leaves.card(p, _b.copy(tan).multiplyScalar(len * 0.85), side2.multiplyScalar(w * 0.8), normalAt, aoAt);
        }
      }
      // Side shoots fanning out either side of the outer branch.
      if (L > 1.1) {
        for (const s of [-1, 1]) {
          const p = along(range(rng, 0.62, 0.8));
          fan.copy(tan).applyAxisAngle(UP, s * range(rng, 0.45, 0.65));
          side.crossVectors(UP, fan).normalize().applyAxisAngle(fan, range(rng, -0.5, 0.5));
          cardN.crossVectors(fan, side).normalize();
          if (cardN.y < 0) cardN.negate();
          p.addScaledVector(fan, len * 0.6);
          leaves.card(p, _b.copy(fan).multiplyScalar(len * 0.75), side.clone().multiplyScalar(0.36 * (1 - 0.25 * t)), normalAt, aoAt);
        }
      }
    }
    y += range(rng, 0.46, 0.6);
    whorl++;
  }
  // Leader: a few upright sprays at the top.
  const tip = trunkAt(H, new THREE.Vector3());
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    side.set(Math.cos(a), 0, Math.sin(a));
    cardN.set(-side.z, 0.2, side.x).normalize();
    leaves.card(tip.clone().add(_a.set(0, -0.55, 0)), _b.set(0, 0.7, 0), side.clone().multiplyScalar(0.3), normalAt, aoAt);
  }
  return { bark: bark.build(), leaves: leaves.build(), crown: crown.build(), height: H, radius: maxL + 0.4 };
}

// A broadleaf (oak-like): a trunk that forks into curving limbs and side
// branches, with leaf clusters at the branch ends and spread through the
// whole crown, around a small dark core.
export function buildBroadleaf(seed, height = 10) {
  const rng = mulberry32(seed);
  const bark = new Builder(), leaves = new Builder(), crown = new Builder();
  const H = height * range(rng, 0.9, 1.1);
  const r0 = 0.26 + H * 0.014;
  const fork = H * range(rng, 0.28, 0.36);
  const lx = range(rng, -0.06, 0.06), lz = range(rng, -0.06, 0.06);
  // Trunk with a root flare, carried on past the fork as a tapering leader
  // that the limbs grow out of (no open end at the fork).
  const trunk = [], radii = [];
  for (const [y, r] of ROOT_FLARE) {
    trunk.push(new THREE.Vector3(0, y, 0));
    radii.push(r0 * r);
  }
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    const yy = 0.9 + (fork - 0.9) * t;
    trunk.push(new THREE.Vector3(lx * (yy / fork), yy, lz * (yy / fork)));
    radii.push(r0 * (1.1 - 0.25 * t));
  }
  const top = trunk[trunk.length - 1].clone();
  trunk.push(top.clone().add(_a.set(lx * 0.5, 0.45, lz * 0.5)), top.clone().add(_a.set(lx, 0.9, lz)));
  radii.push(r0 * 0.62, r0 * 0.2);
  bark.tube(trunk, radii, 8, 2, 0.45, trunkAO((t) => 0.75 + 0.2 * t));

  const clusters = [];
  const limbs = 3 + (rng() < 0.6 ? 1 : 0);
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + range(rng, -0.4, 0.4);
    const tilt = range(rng, 0.45, 0.8);
    const Ll = H * range(rng, 0.34, 0.44);
    // Limbs start inside the trunk, below the fork.
    const pts = [top.clone().add(_a.set(0, -0.35, 0))];
    const d = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
    for (let i = 1; i <= 4; i++) {
      d.x += range(rng, -0.12, 0.12); d.z += range(rng, -0.12, 0.12);
      d.y += 0.06 - 0.03 * i;
      d.normalize();
      pts.push(pts[i - 1].clone().addScaledVector(d, Ll / 4));
    }
    const rl = r0 * 0.58;
    bark.tube(pts, [rl, rl * 0.78, rl * 0.55, rl * 0.35, rl * 0.18], 6, 1, 0.45, (t) => 0.7 + 0.2 * t);
    clusters.push(pts[4].clone(), pts[3].clone().lerp(pts[4], 0.5));
    // Side branches.
    for (const f of [0.35, 0.5, 0.65, 0.8]) {
      if (rng() < 0.12) continue;
      const i = Math.floor(f * 4), ft = f * 4 - i;
      const s0 = pts[i].clone().lerp(pts[i + 1], ft);
      const out = new THREE.Vector3(s0.x - top.x, 0, s0.z - top.z);
      if (out.lengthSq() < 1e-4) out.set(Math.cos(a), 0, Math.sin(a));
      out.normalize();
      const sd = out.clone().multiplyScalar(0.8).add(_a.set(range(rng, -0.5, 0.5), range(rng, 0.15, 0.6), range(rng, -0.5, 0.5))).normalize();
      const Ls = range(rng, 1.3, 2.4) * (H / 10);
      const s1 = s0.clone().addScaledVector(sd, Ls * 0.5);
      const s2 = s1.clone().addScaledVector(sd, Ls * 0.5).add(_a.set(0, -0.12 * Ls, 0));
      bark.tube([s0, s1, s2], [rl * 0.32, rl * 0.18, rl * 0.06], 4, 1, 0.6, () => 0.65);
      clusters.push(s2, s1.clone().lerp(s2, 0.3));
    }
  }

  // Crown shape from the branch-end clusters.
  const cc = new THREE.Vector3();
  for (const c of clusters) cc.add(c);
  cc.divideScalar(clusters.length);
  let rx = 0, ry = 0;
  for (const c of clusters) {
    rx = Math.max(rx, Math.hypot(c.x - cc.x, c.z - cc.z));
    ry = Math.max(ry, Math.abs(c.y - cc.y));
  }
  rx += 1.2; ry += 1.2;
  const rz = rx;
  const n = new THREE.Vector3(), out = new THREE.Vector3(), cardN = new THREE.Vector3();
  const outward = (p) => out.set((p.x - cc.x) / rx, (p.y - cc.y) / ry + 0.25, (p.z - cc.z) / rz).normalize();
  const normalAt = (p) => bentNormal(cardN, outward(p), 0.75, n);
  const aoAt = (p) => {
    const e = Math.hypot((p.x - cc.x) / rx, (p.y - cc.y) / ry, (p.z - cc.z) / rz);
    const vert = clamp((p.y - (cc.y - ry)) / (2 * ry), 0, 1);
    return clamp(0.3 + 0.7 * smoothstep(0.15, 1.0, e) * (0.65 + 0.35 * vert), 0.25, 1);
  };

  // More clusters through the rest of the crown, mostly in its outer half,
  // so there are no holes between the branch ends.
  const fill = Math.round(26 * (H / 10));
  const dir = new THREE.Vector3();
  for (let k = 0, tries = 0; k < fill && tries < fill * 4; tries++) {
    randomUnit(rng, dir, 0.2);
    const r = Math.sqrt(range(rng, 0.2, 0.85));
    const p = new THREE.Vector3(cc.x + dir.x * rx * r * 0.85, cc.y + dir.y * ry * r * 0.85, cc.z + dir.z * rz * r * 0.85);
    if (p.y < fork + 0.8) continue;
    clusters.push(p);
    k++;
  }

  // Small dark core deep inside the leaves, so you can't see straight
  // through the middle of the crown.
  const lump = (phase) => (d) => 1 + 0.1 * Math.sin(3 * Math.atan2(d.z, d.x) + phase) * Math.sin(2.5 * d.y + phase);
  // Raised so its underside stays hidden behind the lowest leaves.
  crown.blob(_a.set(cc.x, cc.y + ry * 0.18, cc.z), rx * 0.33, ry * 0.33, rz * 0.33, 14, 10, (p) => outward(p), (p) => aoAt(p) * 0.75, lump(rng() * 6));

  const u = new THREE.Vector3(), w = new THREE.Vector3();
  for (const c of clusters) {
    const cards = 5 + Math.floor(rng() * 3);
    for (let k = 0; k < cards; k++) {
      const p = c.clone().add(randomUnit(rng, _a, 0).multiplyScalar(range(rng, 0.1, 0.95)));
      randomUnit(rng, cardN, 0.6);
      u.crossVectors(cardN, randomUnit(rng, _c)).normalize();
      w.crossVectors(cardN, u).normalize();
      const s = range(rng, 0.62, 0.9) * (H / 10);
      leaves.card(p, u.clone().multiplyScalar(s), w.clone().multiplyScalar(s), normalAt, aoAt);
    }
  }
  return { bark: bark.build(), leaves: leaves.build(), crown: crown.build(), height: H, radius: rx };
}

// A shrub: a few short stems and a dome of leaf cards.
export function buildBush(seed) {
  const rng = mulberry32(seed);
  const bark = new Builder(), leaves = new Builder();
  const h = range(rng, 0.9, 1.3), r = range(rng, 0.8, 1.1);
  const c = new THREE.Vector3(0, h * 0.55, 0);
  for (let k = 0; k < 3; k++) {
    const a = rng() * Math.PI * 2;
    const tip = new THREE.Vector3(Math.cos(a) * r * 0.5, h * 0.8, Math.sin(a) * r * 0.5);
    bark.tube([new THREE.Vector3(0, -0.1, 0), tip], [0.035, 0.01], 3, 1, 1, () => 0.4);
  }
  const n = new THREE.Vector3(), out = new THREE.Vector3(), cardN = new THREE.Vector3();
  const normalAt = (p) => bentNormal(cardN, out.set(p.x - c.x, (p.y - c.y) + 0.3, p.z - c.z).normalize(), 0.75, n);
  const aoAt = (p) => clamp(0.3 + 0.7 * smoothstep(0.0, 1.0, Math.hypot((p.x - c.x) / r, (p.y - c.y) / (h * 0.6), (p.z - c.z) / r)) * clamp(p.y / h + 0.3, 0, 1), 0.25, 1);
  const u = new THREE.Vector3(), w = new THREE.Vector3();
  for (let k = 0; k < 16; k++) {
    const dir = randomUnit(rng, new THREE.Vector3(), 0.5);
    const p = c.clone().add(new THREE.Vector3(dir.x * r, dir.y * h * 0.5, dir.z * r).multiplyScalar(range(rng, 0.3, 0.9)));
    p.y = Math.max(p.y, 0.25);
    randomUnit(rng, cardN, 0.5);
    u.crossVectors(cardN, randomUnit(rng, _c)).normalize();
    w.crossVectors(cardN, u).normalize();
    const s = range(rng, 0.44, 0.6);
    leaves.card(p, u.clone().multiplyScalar(s), w.clone().multiplyScalar(s), normalAt, aoAt);
  }
  return { bark: bark.build(), leaves: leaves.build(), height: h, radius: r };
}

// A weathered boulder: a noisy sphere cut by a few planes into facets,
// flattened and settled on a flat base. Smooth shaded, no UVs (triplanar).
export function buildRock(seed, detail = 2) {
  const rng = mulberry32(seed);
  const simplex = new SimplexNoise({ random: rng });
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const planes = Array.from({ length: 6 }, () => ({
    n: randomUnit(rng, new THREE.Vector3(), 0.2), d: range(rng, 0.62, 0.86),
  }));
  const squash = range(rng, 0.55, 0.8);
  const pos = g.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    const n1 = simplex.noise3d(p.x * 1.3, p.y * 1.3, p.z * 1.3);
    const n2 = simplex.noise3d(p.x * 3.4 + 7, p.y * 3.4, p.z * 3.4);
    p.multiplyScalar(1 + 0.2 * n1 + 0.07 * n2);
    for (const pl of planes) {
      const over = p.dot(pl.n) - pl.d;
      if (over > 0) p.addScaledVector(pl.n, -over * 0.9);
    }
    p.y *= squash;
    if (p.y < -0.2) p.y = -0.2 + (p.y + 0.2) * 0.25;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
