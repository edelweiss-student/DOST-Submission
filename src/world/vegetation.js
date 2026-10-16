import * as THREE from 'three';
import { range, smoothstep, uniforms } from '../shared.js';
import { patchMaterial, foliageDepthMaterial } from './materials.js';
import { buildConifer, buildBroadleaf, buildBush, buildRock, thinCards } from './trees.js';
import { leafSprite, needleSprite } from './textures.js';

// Uniform grid of circular colliders (tree trunks, boulders).
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

const TREE_SWAY = 0.6;    // bark and leaves must match so leaves stay on their branches
const LOD_BAND = 8;       // metres over which near trees dither into billboards

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

// Billboards for distant trees: each variant is drawn once, from the side,
// into an atlas of colour and normals. A billboard turns to face the camera
// and is lit with the baked normals, so it shades like the real tree.
function bakeImpostors(renderer, variants, tile, anisotropy) {
  const cols = 3, rows = Math.ceil(variants.length / cols);
  const tw = tile, th = tile * 2;
  const W = cols * tw, H = rows * th;
  const options = {
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy,
  };
  const targets = [new THREE.WebGLRenderTarget(W, H, options), new THREE.WebGLRenderTarget(W, H, options)];

  const partMaterial = (map, isLeaf, mode) => new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, mode: { value: mode }, leaf: { value: isLeaf } },
    vertexColors: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying float vAO;
      void main() {
        vUv = uv; vN = normal; vAO = color.r;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform int mode; uniform bool leaf;
      varying vec2 vUv; varying vec3 vN; varying float vAO;
      void main() {
        vec4 t = texture2D( map, vUv );
        if ( leaf && t.a < 0.45 ) discard;
        vec3 c = leaf ? t.rgb : t.rgb * t.rgb;
        gl_FragColor = mode == 0 ? vec4( sqrt( c * vAO ), 1.0 ) : vec4( normalize( vN ) * 0.5 + 0.5, 1.0 );
      }`,
  });
  // Background: a leaf colour (or flat normal) with zero alpha, so mipmaps
  // don't bleed black into the edges.
  const background = (rgb) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4( position.xy, 1.0, 1.0 ); }',
      fragmentShader: `void main() { gl_FragColor = vec4( ${rgb.map((v) => v.toFixed(3)).join(', ')}, 0.0 ); }`,
      depthWrite: false, depthTest: false,
    }));
    m.frustumCulled = false;
    m.renderOrder = -1;
    return m;
  };
  const backgrounds = [background([0.5, 0.58, 0.4]), background([0.5, 0.5, 1.0])];

  const camera = new THREE.OrthographicCamera();
  const prevTarget = renderer.getRenderTarget();
  variants.forEach((v, i) => {
    const box = new THREE.Box3().union(v.geometry.bark.boundingBox).union(v.geometry.leaves.boundingBox);
    const half = Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) + 0.1;
    let w = 2 * half, h = box.max.y - box.min.y + 0.2;
    if (w * 2 > h) h = w * 2; else w = h / 2;
    const y0 = box.min.y - 0.1;
    Object.assign(camera, { left: -w / 2, right: w / 2, bottom: y0, top: y0 + h, near: 0.1, far: 400 });
    camera.position.set(0, 0, 200);
    camera.updateProjectionMatrix();
    const col = i % cols, row = Math.floor(i / cols);
    v.impostor = { w, h, y0, tile: [(col * tw) / W, (row * th) / H, tw / W, th / H] };

    targets.forEach((target, mode) => {
      const scene = new THREE.Scene();
      scene.add(backgrounds[mode]);
      scene.add(new THREE.Mesh(v.geometry.bark, partMaterial(v.barkMap, false, mode)));
      scene.add(new THREE.Mesh(v.geometry.leaves, partMaterial(v.leafMap, true, mode)));
      target.viewport.set(col * tw, row * th, tw, th);
      target.scissor.set(col * tw, row * th, tw, th);
      target.scissorTest = true;
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      scene.traverse((o) => { if (o.material && !backgrounds.includes(o)) o.material.dispose(); });
    });
  });
  renderer.setRenderTarget(prevTarget);
  return { albedo: targets[0].texture, normal: targets[1].texture };
}

const IMPOSTOR_VERTEX_HEAD = /* glsl */ `
attribute vec4 iPos;     // base x, y, z, mirror (+-1)
attribute vec4 iSize;    // width, height, unused, quad bottom relative to the tree base
attribute vec4 iTile;    // atlas offset, scale
attribute vec3 iColor;
varying vec3 vImpRight;
varying vec3 vImpFwd;
varying float vImpFlip;
varying vec3 vImpColor;
varying float vImpLod;
`;
const IMPOSTOR_BEGIN_NORMAL = /* glsl */ `
vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );
vec3 impBase = iPos.xyz;
vec2 toCam = cameraPosition.xz - impBase.xz;
float camDist = max( length( toCam ), 1e-3 );
vec3 impFwd = vec3( toCam.x, 0.0, toCam.y ) / camDist;
vec3 impRight = vec3( impFwd.z, 0.0, -impFwd.x );
float impLod = 1.0 - smoothstep( uLodRange.x, uLodRange.y, camDist );
float impH = position.y * iSize.y;
vec3 impPos = impBase + impRight * ( position.x * iSize.x ) + vec3( 0.0, impH, 0.0 );
// Same wind sway as the 3D trees.
float ph = impBase.x * 0.07 + impBase.z * 0.05;
float gust = sin( uTime * ( 1.3 + uWind * 2.0 ) + ph ) * 0.6 + sin( uTime * 3.1 + ph * 1.7 ) * 0.4;
float swayH = max( impH + iSize.w, 0.0 );
impPos.xz += uWindDir * ( ${TREE_SWAY.toFixed(2)} * swayH * swayH * 0.008 ) * ( uWind * 0.8 + gust * ( 0.2 + 0.6 * uWind ) );
if ( impLod > 0.999 ) impPos = impBase;   // the 3D tree is fully shown here
vImpRight = impRight;
vImpFwd = impFwd;
vImpFlip = iPos.w;
vImpColor = iColor;
vImpLod = impLod;
`;
const IMPOSTOR_BEGIN = /* glsl */ `
vec3 transformed = impPos;
#ifdef USE_MAP
  vMapUv = iTile.xy + vec2( iPos.w > 0.0 ? uv.x : 1.0 - uv.x, uv.y ) * iTile.zw;
#endif
`;
const IMPOSTOR_FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D tImpNormal;
varying vec3 vImpRight;
varying vec3 vImpFwd;
varying float vImpFlip;
varying vec3 vImpColor;
varying float vImpLod;
vec3 btImpW;
`;
const IMPOSTOR_COLOR = /* glsl */ `
if ( btDither( gl_FragCoord.xy ) < vImpLod ) discard;
diffuseColor.rgb *= vImpColor;
{
  vec3 nb = texture2D( tImpNormal, vMapUv ).xyz * 2.0 - 1.0;
  nb.x *= vImpFlip;
  btImpW = normalize( vImpRight * nb.x + vec3( 0.0, nb.y, 0.0 ) + vImpFwd * nb.z );
  btUpN = btImpW.y;
}
`;
const IMPOSTOR_NORMAL = /* glsl */ `
float faceDirection = 1.0;
vec3 normal = normalize( ( viewMatrix * vec4( btImpW, 0.0 ) ).xyz );
vec3 nonPerturbedNormal = normal;
`;

export function createVegetation(scene, terrain, rng, renderer, { quality, ground, bark, cloudShadows }) {
  const colliders = new ColliderGrid();
  const near = [];
  const pines = [], oaks = [], bushes = [], rocks = [];
  const shadows = quality.shadowMap > 0;
  const msaa = quality.antialias;

  const spacingOk = (x, z, min) =>
    colliders.query(x, z, near).every((c) => (c.x - x) ** 2 + (c.z - z) ** 2 > min * min);

  // Trees: dense where the forest noise is high, thinning toward meadows.
  for (let k = 0; k < 40000 && pines.length + oaks.length < 2200; k++) {
    const x = range(rng, -300, 300), z = range(rng, -300, 300);
    const h = terrain.heightAt(x, z);
    if (h < 2.6 || h > 42 || terrain.slopeAt(x, z) > 0.12) continue;
    const f = terrain.forestDensity(x, z);
    if (rng() > smoothstep(-0.35, 0.3, f) * 0.92 + 0.03) continue;
    if (!spacingOk(x, z, 3.6)) continue;
    const s = range(rng, 0.8, 1.25);
    const tree = { x, y: h - 0.15, z, rot: rng() * Math.PI * 2, s, sy: range(rng, 0.92, 1.12), tone: rng(), variant: Math.floor(rng() * 3) };
    (h > 18 || f > 0.25 || rng() < 0.45 ? pines : oaks).push(tree);
    colliders.add(x, z, 0.4 * s);
  }

  for (let k = 0; k < 6000 && bushes.length < 1000; k++) {
    const x = range(rng, -300, 300), z = range(rng, -300, 300);
    const h = terrain.heightAt(x, z);
    if (h < 2.2 || h > 34 || terrain.slopeAt(x, z) > 0.2) continue;
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

  // Crowns shade the ground beneath them.
  for (const t of pines) terrain.addCanopy(t.x, t.z, 3.4 * t.s, 0.9);
  for (const t of oaks) terrain.addCanopy(t.x, t.z, 4.4 * t.s, 1);
  for (const b of bushes) terrain.addCanopy(b.x, b.z, 1.3 * b.s, 0.4);
  terrain.commitCanopy();

  const aniso = quality.anisotropy;
  const needleTex = needleSprite(aniso), leafTex = leafSprite(aniso);
  const species = [
    {
      name: 'pine', list: pines, leafMap: needleTex, barkTex: bark.pine, flutter: 0.4,
      geometry: [11, 12, 13].map((seed) => buildConifer(seed, 13)),
      toneA: new THREE.Color(0.82, 0.92, 0.84), toneB: new THREE.Color(1.05, 1.06, 0.92),
    },
    {
      name: 'oak', list: oaks, leafMap: leafTex, barkTex: bark.oak, flutter: 1,
      geometry: [21, 22, 23].map((seed) => buildBroadleaf(seed, 10)),
      toneA: new THREE.Color(0.9, 1.0, 0.85), toneB: new THREE.Color(1.15, 1.08, 0.78),
    },
  ];

  // Leaves cast shadows through thinned stand-ins (half the cards), drawn
  // only into the shadow map: seen from the sun, the lower layers of a
  // crown are hidden by the upper ones, so the shadow looks the same at
  // half the cost. The shadow pass only draws visible objects, so the
  // stand-ins are switched on just for it.
  const shadowOnly = [];
  if (shadows) {
    const renderShadows = renderer.shadowMap.render;
    renderer.shadowMap.render = function (...args) {
      for (const m of shadowOnly) m.visible = true;
      renderShadows.apply(this, args);
      for (const m of shadowOnly) m.visible = false;
    };
  }

  // --- Near trees: full 3D, rebuilt as the player moves.
  const variants = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), tone = new THREE.Color();
  for (const sp of species) {
    const leafMat = patchMaterial(
      new THREE.MeshLambertMaterial({ map: sp.leafMap, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, alphaToCoverage: msaa }),
      { key: 'leaf-' + sp.name, sway: TREE_SWAY, flutter: sp.flutter, foliage: 0.8, lod: true, dry: true, snowMin: 0.35, cloudShadows, hardShadow: true },
    );
    const barkMat = patchMaterial(
      new THREE.MeshLambertMaterial({ map: sp.barkTex.albedo, normalMap: sp.barkTex.normal, vertexColors: true }),
      { key: 'bark-' + sp.name, sway: TREE_SWAY, snowMin: 0.95, lod: true, sqrtMap: true, cloudShadows },
    );
    const leafDepth = foliageDepthMaterial({ key: 'leaf-' + sp.name, map: sp.leafMap, alphaTest: 0.45, sway: TREE_SWAY, flutter: sp.flutter });
    const barkDepth = foliageDepthMaterial({ key: 'bark-' + sp.name, sway: TREE_SWAY });
    sp.geometry.forEach((geometry, vi) => {
      const trees = sp.list.filter((t) => t.variant === vi);
      const cap = Math.max(1, trees.length);
      const barkMesh = new THREE.InstancedMesh(geometry.bark, barkMat, cap);
      const leafMesh = new THREE.InstancedMesh(geometry.leaves, leafMat, cap);
      leafMesh.instanceMatrix = barkMesh.instanceMatrix;
      barkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      leafMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const leafShadow = new THREE.InstancedMesh(thinCards(geometry.leaves), leafMat, cap);
      leafShadow.instanceMatrix = barkMesh.instanceMatrix;
      leafShadow.instanceColor = leafMesh.instanceColor;
      for (const mesh of [barkMesh, leafMesh, leafShadow]) {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        scene.add(mesh);
      }
      leafMesh.castShadow = false;
      leafShadow.receiveShadow = false;
      leafShadow.visible = false;
      leafShadow.customDepthMaterial = leafDepth;
      barkMesh.customDepthMaterial = barkDepth;
      shadowOnly.push(leafShadow);
      const variant = {
        geometry, barkMesh, leafMesh, leafShadow, trees, barkMap: sp.barkTex.albedo, leafMap: sp.leafMap,
        // Per tree: world matrix and leaf tint, ready to copy.
        matrices: new Float32Array(trees.length * 16), colors: new Float32Array(trees.length * 3),
      };
      trees.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        m.compose(p.set(t.x, t.y, t.z), q, sc.set(t.s, t.s * t.sy, t.s));
        m.toArray(variant.matrices, i * 16);
        tone.copy(sp.toneA).lerp(sp.toneB, t.tone).toArray(variant.colors, i * 3);
        t.index = i;
      });
      variants.push(variant);
    });
  }

  // Trees are written nearest first, so leaves behind already-drawn leaves
  // are rejected by the depth test instead of being shaded (big savings in
  // dense forest, where many layers of leaves overlap).
  const nearRadius = quality.nearTrees;
  uniforms.uLodRange.value.set(nearRadius - LOD_BAND, nearRadius);
  const last = new THREE.Vector2(1e9, 1e9);
  const picked = [];
  function updateNear(camera) {
    const cx = camera.position.x, cz = camera.position.z;
    if ((cx - last.x) ** 2 + (cz - last.y) ** 2 < 4) return;
    last.set(cx, cz);
    const r2 = (nearRadius + 3) ** 2;
    for (const v of variants) {
      const mat = v.barkMesh.instanceMatrix, col = v.leafMesh.instanceColor;
      picked.length = 0;
      for (const t of v.trees) {
        t.d2 = (t.x - cx) ** 2 + (t.z - cz) ** 2;
        if (t.d2 <= r2) picked.push(t);
      }
      picked.sort((a, b) => a.d2 - b.d2);
      picked.forEach((t, n) => {
        mat.array.set(v.matrices.subarray(t.index * 16, t.index * 16 + 16), n * 16);
        col.array.set(v.colors.subarray(t.index * 3, t.index * 3 + 3), n * 3);
      });
      const n = picked.length;
      v.barkMesh.count = v.leafMesh.count = v.leafShadow.count = n;
      mat.clearUpdateRanges();
      mat.addUpdateRange(0, n * 16);
      mat.needsUpdate = true;
      col.clearUpdateRanges();
      col.addUpdateRange(0, n * 3);
      col.needsUpdate = true;
    }
  }

  // --- Far trees: one draw call of billboards for the whole island, also
  // kept sorted nearest first (re-sorted every few metres of movement).
  const atlas = bakeImpostors(renderer, variants, quality.impostorTile, aniso);
  const all = variants.flatMap((v) => v.trees.map((t) => ({ t, v, d2: 0 })));
  const iPos = new Float32Array(all.length * 4), iSize = new Float32Array(all.length * 4);
  const iTile = new Float32Array(all.length * 4), iColor = new Float32Array(all.length * 3);
  const impLast = new THREE.Vector2(1e9, 1e9);
  function sortImpostors(camera) {
    const cx = camera.position.x, cz = camera.position.z;
    if ((cx - impLast.x) ** 2 + (cz - impLast.y) ** 2 < 36) return;
    impLast.set(cx, cz);
    for (const e of all) e.d2 = (e.t.x - cx) ** 2 + (e.t.z - cz) ** 2;
    all.sort((a, b) => a.d2 - b.d2);
    all.forEach(({ t, v }, i) => {
      const imp = v.impostor, sy = t.s * t.sy;
      iPos[i * 4] = t.x; iPos[i * 4 + 1] = t.y + imp.y0 * sy; iPos[i * 4 + 2] = t.z;
      iPos[i * 4 + 3] = (t.tone * 997) % 1 < 0.5 ? 1 : -1;
      // x: width, y: height, w: height of the quad's base above the tree's base (for sway).
      iSize[i * 4] = imp.w * t.s; iSize[i * 4 + 1] = imp.h * sy; iSize[i * 4 + 3] = imp.y0 * sy;
      iTile.set(imp.tile, i * 4);
      iColor.set(v.colors.subarray(t.index * 3, t.index * 3 + 3), i * 3);
    });
    for (const name of ['iPos', 'iSize', 'iTile', 'iColor']) impGeo.attributes[name].needsUpdate = true;
  }
  const quad = new THREE.BufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  quad.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  quad.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const impGeo = new THREE.InstancedBufferGeometry().copy(quad);
  impGeo.instanceCount = all.length;
  impGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
  impGeo.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 4));
  impGeo.setAttribute('iTile', new THREE.InstancedBufferAttribute(iTile, 4));
  impGeo.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3));
  const impMat = new THREE.MeshLambertMaterial({ map: atlas.albedo, alphaTest: 0.5, alphaToCoverage: msaa });
  impMat.defines = { BT_CUSTOM_UP: '' };
  patchMaterial(impMat, {
    key: 'impostor', foliage: 0.6, dry: true, snowMin: 0.35, sqrtMap: true, cloudShadows,
    custom: {
      uniforms: { tImpNormal: { value: atlas.normal } },
      vertexHead: IMPOSTOR_VERTEX_HEAD, beginNormal: IMPOSTOR_BEGIN_NORMAL, begin: IMPOSTOR_BEGIN,
      fragmentHead: IMPOSTOR_FRAGMENT_HEAD, color: IMPOSTOR_COLOR, normal: IMPOSTOR_NORMAL,
    },
  });
  const impostors = new THREE.Mesh(impGeo, impMat);
  impostors.frustumCulled = false;
  scene.add(impostors);

  // --- Bushes: always 3D (they're small), two shapes, in culled chunks.
  const bushGeos = [buildBush(31), buildBush(32)];
  const bushMat = patchMaterial(
    new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, alphaToCoverage: msaa }),
    { key: 'bush', sway: 2, flutter: 1, foliage: 0.8, dry: true, snowMin: 0.35, cloudShadows, hardShadow: true, fadeOut: [62, 76] },
  );
  const bushDepth = foliageDepthMaterial({ key: 'bush', map: leafTex, alphaTest: 0.45, sway: 2, flutter: 1 });
  const bushTones = [new THREE.Color(0.85, 0.98, 0.8), new THREE.Color(1.1, 1.06, 0.78)];
  const chunks = [];
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

  return {
    colliders,
    counts: { pines: pines.length, oaks: oaks.length, bushes: bushes.length, rocks: rocks.length },
    update(camera) {
      updateNear(camera);
      sortImpostors(camera);
      for (const c of chunks) c.update(camera);
    },
  };
}
