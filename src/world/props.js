import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, range, clamp, smoothstep } from '../shared.js';

// Procedural bush and boulder geometry. A bush is a dome of alpha-tested
// leaf cards whose normals point outwards from the dome, so it shades as
// one soft volume. Vertex colour carries ambient occlusion (darker inside
// and underneath).

const _a = new THREE.Vector3(), _c = new THREE.Vector3(), _corner = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const CORNERS = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];

export class Builder {
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

  // A card centred on c, spanning +-ux along u and +-vy along v. Normals come
  // from nfn(position) so they can bend with the dome.
  card(c, ux, vy, nfn, aofn) {
    const first = this.pos.length / 3;
    for (const [su, sv, u, v] of CORNERS) {
      _corner.copy(c).addScaledVector(ux, su).addScaledVector(vy, sv);
      this.vert(_corner, nfn(_corner), u, v, aofn(_corner));
    }
    this.idx.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
}

function randomUnit(rng, out, upBias = 0) {
  const z = range(rng, -1, 1), a = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z + upBias, r * Math.sin(a)).normalize();
}

// Bends a card normal towards the outward dome direction.
function bentNormal(cardN, outward, amount, out) {
  return out.copy(cardN).lerp(outward, amount).normalize();
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
