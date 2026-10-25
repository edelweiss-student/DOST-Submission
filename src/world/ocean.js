import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD, range, mulberry32 } from '../shared.js';
import { patchMaterial } from './materials.js';
import { rockMaterial, rockGeometries, InstanceChunks, fillInstances } from './vegetation.js';
import { kelpSprite } from './textures.js';

// Random seabed points whose depth (below the starting sea level) is in range.
function seabedPoints(terrain, rng, count, minDepth, maxDepth, clusters = 0) {
  const out = [];
  const centers = [];
  for (let k = 0; k < count * 40 && out.length < count; k++) {
    let x, z;
    if (clusters && centers.length >= clusters) {
      const c = centers[Math.floor(rng() * centers.length)];
      x = c.x + range(rng, -9, 9); z = c.z + range(rng, -9, 9);
    } else {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * WORLD.maxRadius;
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    const h = terrain.heightAt(x, z);
    if (h > -minDepth || h < -maxDepth) continue;
    if (clusters && centers.length < clusters) centers.push({ x, z });
    out.push({ x, y: h, z, r: rng() });
  }
  return out;
}

// Seabed objects in chunks that are skipped when out of view or farther
// than the water lets you see.
const SEABED_VIEW = 110;
function scatter(scene, geometry, material, points, rng, scaleFn, colorFn, sink = 0.2) {
  const s = new THREE.Vector3();
  const items = points.map((pt) => {
    scaleFn(s, pt);
    return {
      x: pt.x, y: pt.y - sink, z: pt.z, rot: rng() * Math.PI * 2,
      tx: range(rng, -0.15, 0.15), tz: range(rng, -0.15, 0.15), sx: s.x, sy: s.y, sz: s.z, pt,
    };
  });
  return new InstanceChunks(scene, geometry, material, items, {
    size: 80, maxDistance: SEABED_VIEW, fill: fillInstances(colorFn ? (it) => colorFn(it.pt) : null),
  });
}

// Tube helper for coral branches: a tapered cylinder from a to b.
function limb(a, b, r0, r1, sides = 5) {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, false).translate(0, len / 2, 0);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(a.x, a.y, a.z);
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

// Staghorn coral: branches forking upwards.
function branchingCoral(seed) {
  const rng = mulberry32(seed);
  const parts = [];
  const grow = (a, dir, len, r, depth) => {
    const b = a.clone().addScaledVector(dir, len);
    parts.push(limb(a, b, r, r * 0.7));
    if (depth === 0) {
      parts.push(new THREE.SphereGeometry(r * 0.75, 5, 4).translate(b.x, b.y, b.z).toNonIndexed().deleteAttribute('uv'));
      return;
    }
    const n = depth === 2 ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const d = dir.clone().add(new THREE.Vector3(range(rng, -0.7, 0.7), range(rng, 0.1, 0.5), range(rng, -0.7, 0.7))).normalize();
      grow(b, d, len * range(rng, 0.6, 0.85), r * 0.7, depth - 1);
    }
  };
  grow(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, 1, 0), 0.35, 0.09, 2);
  return mergeGeometries(parts); // keeps the parts' smooth normals
}

// Brain coral: a squat dome with meandering grooves.
function brainCoral(seed) {
  const simplex = new SimplexNoise({ random: mulberry32(seed) });
  let g = new THREE.IcosahedronGeometry(0.7, 3);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const pos = g.attributes.position, p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    const groove = Math.abs(Math.sin(simplex.noise3d(p.x * 2.2, p.y * 2.2, p.z * 2.2) * 9));
    p.multiplyScalar(0.7 * (1 + 0.06 * groove + 0.08 * simplex.noise3d(p.x, p.y, p.z)));
    p.y = p.y < 0 ? p.y * 0.15 : p.y * 0.7;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
}

// Table coral: a short stalk carrying a wavy plate.
function tableCoral(seed) {
  const simplex = new SimplexNoise({ random: mulberry32(seed) });
  const stalk = limb(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, 0.45, 0), 0.12, 0.08, 6);
  const plate = new THREE.CylinderGeometry(0.85, 0.6, 0.08, 18, 1).translate(0, 0.5, 0);
  plate.deleteAttribute('uv');
  const pos = plate.attributes.position, p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    p.y += simplex.noise(p.x * 1.6, p.z * 1.6) * 0.08 + Math.hypot(p.x, p.z) * 0.08;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  plate.computeVertexNormals();
  return mergeGeometries([stalk, plate.toNonIndexed()]);
}

// Kelp: a thin stem with blades all the way up (unit height; instances
// are stretched to the water depth).
function kelpGeometry() {
  const rng = mulberry32(17);
  const stem = new THREE.CylinderGeometry(0.015, 0.025, 1, 4, 6).translate(0, 0.5, 0);
  stem.deleteAttribute('uv');
  // Stems use the middle of the blade texture (solid colour).
  const suv = new Float32Array(stem.attributes.position.count * 2).fill(0.5);
  stem.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
  const blades = [];
  const N = 9;
  for (let k = 0; k < N; k++) {
    const y = (k + 0.5) / N;
    const a = k * 2.4 + range(rng, -0.4, 0.4);
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const len = range(rng, 0.7, 1.0), w = 0.16;
    const g = new THREE.PlaneGeometry(w, len, 1, 3);
    g.translate(0, len / 2, 0);
    // Lean the blade outwards and up, with a gentle droop.
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / len;
      pos.setXYZ(i, pos.getX(i), t * len * 0.06, t * len * (1 - 0.3 * t));
    }
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out));
    g.translate(0, y, 0);
    blades.push(g.toNonIndexed());
  }
  const g = mergeGeometries([stem.toNonIndexed(), ...blades]);
  g.computeVertexNormals();
  return g;
}

// A fish body (nose towards +z) with tail and dorsal fins.
function fishGeometry() {
  const body = new THREE.SphereGeometry(0.5, 12, 8).scale(0.22, 0.38, 1).translate(0, 0, 0.05);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, -0.38, 0, 0.2, -0.68, 0, -0.2, -0.68,
  ], 3));
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.17, 0.15, 0, 0.3, -0.12, 0, 0.16, -0.2,
  ], 3));
  const parts = [body.toNonIndexed(), tail, fin].map((g) => {
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.normal) g.deleteAttribute('normal');
    return g;
  });
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  // Countershading: dark back, pale belly.
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(0.5 - pos.getY(i) * 2.6, 0, 1);
    const v = 0.45 + 0.75 * t;
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Fish bend side to side, more towards the tail.
const FISH_BEGIN = /* glsl */ `
vec3 transformed = position;
float swim = sin( uTime * 9.0 + float( gl_InstanceID ) * 1.7 - position.z * 5.0 );
transformed.x += swim * 0.07 * smoothstep( 0.3, -0.7, position.z );
`;

// Everything below the surface: the abyss floor, kelp, coral, rocks and fish.
export function createOcean(scene, terrain, rng, { ground, anisotropy = 4, cloudShadows = false } = {}) {
  const abyss = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#0b1d2a' }),
  );
  abyss.position.y = WORLD.abyssDepth;
  scene.add(abyss);
  const col = new THREE.Color();
  const chunks = [];

  // Kelp forests: tall swaying strands in mid-depth water.
  const kelpMat = patchMaterial(
    new THREE.MeshLambertMaterial({ map: kelpSprite(anisotropy), alphaTest: 0.5, side: THREE.DoubleSide }),
    { key: 'kelp', sway: 1.2, kelp: true, caustics: true, foliage: 0.5, cloudShadows },
  );
  const kelpA = new THREE.Color(0.8, 0.85, 0.7), kelpB = new THREE.Color(1.1, 1.05, 0.8);
  chunks.push(scatter(scene, kelpGeometry(), kelpMat,
    seabedPoints(terrain, rng, 900, 6, 28, 70), rng,
    (s, pt) => s.set(1, Math.min(4 + pt.r * 9, -pt.y - 1.5), 1),
    (pt) => col.copy(kelpA).lerp(kelpB, pt.r)));

  // Coral reef on the shallow shelf. Heat stress bleaches it.
  const coralMat = patchMaterial(
    new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 }),
    { key: 'coral', bleach: true, caustics: true, cloudShadows },
  );
  const coralColors = ['#e8735f', '#f0a050', '#b26fd6', '#e6d06a', '#ef86a8', '#57c0b8', '#d9c3a0'].map((h) => new THREE.Color(h));
  const reef = seabedPoints(terrain, rng, 700, 1.5, 13, 45);
  const kinds = [branchingCoral(5), brainCoral(6), tableCoral(7)];
  kinds.forEach((geometry, kind) => {
    const pts = reef.filter((_, i) => i % 3 === kind);
    chunks.push(scatter(scene, geometry, coralMat, pts, rng,
      (s, pt) => s.setScalar(0.7 + pt.r * 1.1),
      (pt) => col.copy(coralColors[Math.floor(pt.r * 977) % coralColors.length]), 0.1));
  });

  // Seabed boulders.
  const searockMat = rockMaterial(ground, { key: 'searock', moss: false, caustics: true, cloudShadows });
  const rockPts = seabedPoints(terrain, rng, 260, 2, 45);
  const rockTone = [new THREE.Color(0.7, 0.75, 0.75), new THREE.Color(1, 1, 0.95)];
  rockGeometries().forEach((geometry, kind) => {
    const pts = rockPts.filter((_, i) => i % 3 === kind);
    chunks.push(scatter(scene, geometry, searockMat, pts, rng,
      (s, pt) => s.set(1 + pt.r * 2.5, 0.6 + pt.r * 1.5, 1 + pt.r * 2),
      (pt) => col.copy(rockTone[0]).lerp(rockTone[1], pt.r), 0.1));
  });

  // Passive fish schools circling over the reef.
  const fishColors = ['#ffb347', '#ffe066', '#5fa8ff', '#c9d6df', '#ff6b6b', '#9ad0c2'].map((h) => new THREE.Color(h));
  const schools = seabedPoints(terrain, rng, 9, 5, 26).map((pt) => ({
    x: pt.x, z: pt.z, floor: pt.y,
    radius: range(rng, 5, 13), speed: range(rng, 0.25, 0.5) * (rng() < 0.5 ? -1 : 1),
    depthMix: range(rng, 0.3, 0.7), color: fishColors[Math.floor(rng() * fishColors.length)],
    members: Array.from({ length: 12 }, () => ({
      phase: rng() * 0.9, dy: range(rng, -1.2, 1.2), dr: range(rng, -1.5, 1.5), wob: rng() * 6.28,
    })),
  }));
  const fishCount = schools.length * 12;
  const fishMat = patchMaterial(
    new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.15, vertexColors: true }),
    { key: 'fish', caustics: true, custom: { begin: FISH_BEGIN } },
  );
  const fish = new THREE.InstancedMesh(fishGeometry(), fishMat, fishCount);
  fish.frustumCulled = false;
  schools.forEach((sc, si) => sc.members.forEach((_, mi) => fish.setColorAt(si * 12 + mi, sc.color)));
  scene.add(fish);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);

  function update(t, camera, waterLevel) {
    abyss.position.x = camera.position.x;
    abyss.position.z = camera.position.z;
    for (const c of chunks) c.update(camera);

    let i = 0;
    for (const sc of schools) {
      const top = waterLevel - 1.2, bottom = sc.floor + 1.2;
      for (const f of sc.members) {
        const ang = t * sc.speed + f.phase;
        const r = sc.radius + f.dr;
        p.set(sc.x + Math.cos(ang) * r, 0, sc.z + Math.sin(ang) * r);
        const y = bottom + (top - bottom) * sc.depthMix + f.dy + Math.sin(t * 1.3 + f.wob) * 0.4;
        p.y = Math.max(terrain.heightAt(p.x, p.z) + 0.8, Math.min(top, y));
        // Face along the circle's tangent, with a little tail wiggle.
        const heading = -ang - (sc.speed > 0 ? 0 : Math.PI) + Math.sin(t * 8 + f.wob) * 0.12;
        q.setFromAxisAngle(up, heading);
        fish.setMatrixAt(i++, m.compose(p, q, one));
      }
    }
    fish.instanceMatrix.needsUpdate = true;
  }

  // schools: where the fish circle ({ x, z, floor (the seabed), radius }).
  return { update, schools };
}
