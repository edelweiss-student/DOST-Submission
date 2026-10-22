import * as THREE from 'three';
import { range, smoothstep } from '../shared.js';
import { patchMaterial, foliageDepthMaterial } from './materials.js';
import { buildBush, buildRock } from './props.js';
import { leafSprite } from './textures.js';
import { SPECIES, placeTrees, createForest } from './trees.js';

// Uniform grid of circular colliders (tree trunks, fallen trunks, boulders).
export class ColliderGrid {
  constructor(cell = 8) {
    this.cell = cell;
    this.cells = new Map();
  }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(x, z, r) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push({ x, z, r });
  }
  query(x, z, out = []) {
    out.length = 0;
    const ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (list) for (const c of list) out.push(c);
      }
    }
    return out;
  }
}

// Instanced objects split into square chunks, so the GPU only gets the
// chunks that are in view (frustum culling per chunk) and within
// maxDistance of the camera. fill(mesh, items) sets the instances.
export class InstanceChunks {
  constructor(scene, geometry, material, items, { size = 64, maxDistance = Infinity, fill, castShadow = false }) {
    this.maxDistance = maxDistance;
    const cells = new Map();
    for (const it of items) {
      const k = `${Math.floor(it.x / size)},${Math.floor(it.z / size)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(it);
    }
    this.chunks = [...cells.values()].map((list) => {
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      fill(mesh, list);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
  }

  update(camera) {
    if (this.maxDistance === Infinity) return;
    for (const m of this.chunks) {
      const s = m.boundingSphere;
      m.visible = s.center.distanceTo(camera.position) - s.radius < this.maxDistance;
    }
  }
}

// Writes instance matrices (and colours) for items with x, y, z, rot, an
// optional tilt (tx, tz) and either a uniform scale s (with relative
// height sy) or sx, sy, sz.
export function fillInstances(colorFn) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  return (mesh, items) => items.forEach((it, i) => {
    e.set(it.tx ?? 0, it.rot, it.tz ?? 0);
    s.set(it.sx ?? it.s, it.sx ? it.sy : it.sy * it.s, it.sz ?? it.s);
    mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q.setFromEuler(e), s));
    if (colorFn) mesh.setColorAt(i, colorFn(it));
  });
}

// Rock material: rock texture projected from three sides (no UVs needed),
// with moss on top. The seabed version gets caustics instead of moss.
const ROCK_HEAD = /* glsl */ `
uniform sampler2D tRockA;
uniform sampler2D tRockN;
uniform sampler2D tMossA;
vec3 btRockN;
`;
const ROCK_MAP = /* glsl */ `
{
  vec3 n0 = normalize( btWorldNormal );
  vec3 bw = pow( abs( n0 ), vec3( 4.0 ) );
  bw /= bw.x + bw.y + bw.z;
  vec3 p = btWorldPos * 0.3;
  vec4 ax = texture2D( tRockA, p.zy ), ay = texture2D( tRockA, p.xz ), az = texture2D( tRockA, p.xy );
  vec3 alb = ax.rgb * ax.rgb * bw.x + ay.rgb * ay.rgb * bw.y + az.rgb * az.rgb * bw.z;
  vec2 nx = texture2D( tRockN, p.zy ).xy * 2.0 - 1.0;
  vec2 ny = texture2D( tRockN, p.xz ).xy * 2.0 - 1.0;
  vec2 nz = texture2D( tRockN, p.xy ).xy * 2.0 - 1.0;
  btRockN = normalize( n0 + vec3( 0.0, nx.y, nx.x ) * bw.x + vec3( ny.x, 0.0, ny.y ) * bw.y + vec3( nz.x, nz.y, 0.0 ) * bw.z );
  #ifdef BT_MOSS
    float moss = smoothstep( 0.6, 0.85, btRockN.y + ( ay.a - 0.5 ) * 0.5 );
    vec4 m = texture2D( tMossA, btWorldPos.xz * 0.45 );
    alb = mix( alb, m.rgb * m.rgb, moss * 0.9 );
  #endif
  diffuseColor.rgb *= alb;
}
`;
const ROCK_NORMAL = /* glsl */ `
normal = normalize( ( viewMatrix * vec4( btRockN, 0.0 ) ).xyz );
`;

export function rockMaterial(ground, { key, moss = true, caustics = false, cloudShadows = false }) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  if (moss) material.defines = { BT_MOSS: '' };
  return patchMaterial(material, {
    key, caustics, snowMin: 0.5, cloudShadows,
    custom: {
      uniforms: {
        tRockA: { value: ground.rock.albedo }, tRockN: { value: ground.rock.normal },
        tMossA: { value: ground.grass.albedo },
      },
      fragmentHead: ROCK_HEAD, map: ROCK_MAP, normalMaps: ROCK_NORMAL,
    },
  });
}

export function rockGeometries() {
  return [buildRock(41), buildRock(42), buildRock(43)];
}

// Fallen trunks lie in the forest, roughly following the ground.
function placeLogs(terrain, rng, colliders, spacingOk, lengths) {
  const logs = [];
  for (let k = 0; k < 5000 && logs.length < 45; k++) {
    const x = range(rng, -300, 300), z = range(rng, -300, 300);
    const h = terrain.heightAt(x, z);
    if (h < 3.6 || terrain.slopeAt(x, z) > 0.18) continue;
    if (smoothstep(-0.12, 0.3, terrain.forestDensity(x, z)) < 0.5) continue;
    const variant = rng() < 0.3 ? 0 : 1;
    const s = range(rng, 0.8, 1.05);
    const len = lengths[variant] * s;
    // The trunk runs along its own +X axis.
    const yaw = rng() * Math.PI * 2, dx = Math.cos(yaw), dz = -Math.sin(yaw);
    const ex = x + dx * len, ez = z + dz * len;
    if (!spacingOk(x, z, 2) || !spacingOk(x + dx * len * 0.5, z + dz * len * 0.5, 2.5) || !spacingOk(ex, ez, 2)) continue;
    const he = terrain.heightAt(ex, ez);
    if (Math.abs(he - h) > len * 0.25) continue;
    logs.push({ x, y: h - 0.25 * s, z, yaw, pitch: Math.atan2(he - h, len), s, variant, dx, dz, len });
    for (let d = 0.6; d < len - 0.3; d += 1.1) colliders.add(x + dx * d, z + dz * d, (variant === 0 ? 0.6 : 0.45) * s);
  }
  return logs;
}

// Trees, fallen trunks, bushes and boulders.
export function createVegetation(scene, terrain, rng, { quality, ground, cloudShadows, treeModels }) {
  const colliders = new ColliderGrid();
  const found = [];
  const bushes = [], rocks = [];
  const shadows = quality.shadowMap > 0;
  const msaa = quality.antialias;

  const spacingOk = (x, z, min) =>
    colliders.query(x, z, found).every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > min * min);

  // Trees first: everything else keeps clear of their trunks.
  const trees = placeTrees(terrain, rng, colliders, spacingOk);
  const logLengths = treeModels.deadwood.map((v) => v.parts[0].geometry.boundingBox.max.x);
  const logs = placeLogs(terrain, rng, colliders, spacingOk, logLengths);

  for (let k = 0; k < 6000 && bushes.length < 1000; k++) {
    const x = range(rng, -300, 300), z = range(rng, -300, 300);
    const h = terrain.heightAt(x, z);
    if (h < 2.2 || h > 34 || terrain.slopeAt(x, z) > 0.2 || !spacingOk(x, z, 1.2)) continue;
    const s = range(rng, 0.6, 1.3);
    bushes.push({ x, y: h - 0.1, z, rot: rng() * 6.28, s, sy: range(rng, 0.8, 1.2), tone: rng(), variant: Math.floor(rng() * 2) });
  }

  for (let k = 0; k < 5000 && rocks.length < 320; k++) {
    const x = range(rng, -300, 300), z = range(rng, -300, 300);
    const h = terrain.heightAt(x, z);
    if (h < 0.4) continue;
    const slope = terrain.slopeAt(x, z);
    if (rng() > 0.25 + slope * 3) continue;
    const s = range(rng, 0.5, 1.6) * (rng() < 0.12 ? 2.6 : 1);
    if (!spacingOk(x, z, s + 1.5)) continue;
    const sy = s * range(rng, 0.7, 1.1);
    rocks.push({ x, y: h - 0.1 * sy, z, rot: rng() * 6.28, sx: s * range(rng, 0.9, 1.4), sy, sz: s, tone: rng(), variant: Math.floor(rng() * 3) });
    if (s > 0.9) colliders.add(x, z, s * 0.95);
  }

  // Tree crowns and bushes shade the ground beneath them (and you, see player.js).
  for (const t of trees) terrain.addCanopy(t.x, t.z, SPECIES[t.species].crown * t.s, SPECIES[t.species].shade);
  for (const b of bushes) terrain.addCanopy(b.x, b.z, 1.3 * b.s, 0.4);
  terrain.commitCanopy();

  const tone = new THREE.Color();
  const chunks = [];

  // --- Bushes: two shapes, in culled chunks.
  const leafTex = leafSprite(quality.anisotropy);
  const bushGeos = [buildBush(31), buildBush(32)];
  const bushMat = patchMaterial(
    new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, alphaToCoverage: msaa }),
    { key: 'bush', sway: 2, flutter: 1, foliage: 0.8, dry: true, snowMin: 0.35, cloudShadows, hardShadow: true, fadeOut: [62, 76], tree: 'leaves' },
  );
  const bushDepth = foliageDepthMaterial({ key: 'bush', map: leafTex, alphaTest: 0.45, sway: 2, flutter: 1, tree: 'leaves' });
  const bushTones = [new THREE.Color(0.85, 0.98, 0.8), new THREE.Color(1.1, 1.06, 0.78)];
  bushGeos.forEach((g, vi) => {
    const c = new InstanceChunks(scene, g.leaves, bushMat, bushes.filter((b) => b.variant === vi), {
      maxDistance: 78, castShadow: quality.shadowMap >= 2048,
      fill: fillInstances((b) => tone.copy(bushTones[0]).lerp(bushTones[1], b.tone)),
    });
    for (const m of c.chunks) m.customDepthMaterial = bushDepth;
    chunks.push(c);
  });

  // --- Boulders.
  const rockMat = rockMaterial(ground, { key: 'rock', cloudShadows });
  const rockTone = [new THREE.Color(0.85, 0.85, 0.85), new THREE.Color(1.1, 1.07, 1.02)];
  rockGeometries().forEach((g, vi) => {
    chunks.push(new InstanceChunks(scene, g, rockMat, rocks.filter((r) => r.variant === vi), {
      maxDistance: 220, castShadow: shadows,
      fill: fillInstances((r) => tone.copy(rockTone[0]).lerp(rockTone[1], r.tone)),
    }));
  });

  // --- Fallen trunks: tilted to follow the ground along their length.
  const logMat = patchMaterial(
    // Brightened like the oak bark it comes from (see SPECIES.oak.bark in trees.js).
    new THREE.MeshLambertMaterial({ map: treeModels.deadwood[0].parts[0].map, color: new THREE.Color().setScalar(1.5), side: THREE.DoubleSide }),
    { key: 'deadwood', snowMin: 0.6, cloudShadows },
  );
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), mat = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  treeModels.deadwood.forEach((model, vi) => {
    chunks.push(new InstanceChunks(scene, model.parts[0].geometry, logMat, logs.filter((l) => l.variant === vi), {
      maxDistance: 160, castShadow: shadows,
      fill: (mesh, items) => items.forEach((l, i) => {
        qa.setFromAxisAngle(Y, l.yaw).multiply(qb.setFromAxisAngle(Z, l.pitch));
        mesh.setMatrixAt(i, mat.compose(pos.set(l.x, l.y, l.z), qa, scl.setScalar(l.s)));
      }),
    }));
  });

  // --- Trees.
  const forest = createForest(scene, treeModels, trees, { quality, cloudShadows });
  const bySpecies = Object.fromEntries(Object.keys(SPECIES).map((s) => [s, trees.filter((t) => t.species === s).length]));

  return {
    colliders,
    forest,
    // Where things grow and lie, for gathering (see gathering.js).
    sources: { trees, bushes, rocks, logs },
    counts: { trees: trees.length, ...bySpecies, logs: logs.length, bushes: bushes.length, rocks: rocks.length },
    update(camera) {
      for (const c of chunks) c.update(camera);
      forest.update(camera);
    },
  };
}
