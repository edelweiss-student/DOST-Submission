import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { range, smoothstep } from '../shared.js';
import { patchMaterial, foliageDepthMaterial } from './materials.js';

// Trees from the 3D Retro World pack, packed by scripts/import-trees.mjs into
// public/models/trees/<species>.glb. Every variant has a full tree (bark and
// alpha-tested leaves, about 2,000 triangles) and a crossed-card billboard
// for the distance. deadwood.glb holds two fallen trunks.

// Per species:
//   sway      wind bend (it grows with height squared, so tall trees need less)
//   flutter   leaf trembling
//   trunk     trunk collider radius (m)
//   crown     radius of the shade under the crown (m), shade how much light it blocks
//   spacing   minimum distance to the next trunk or boulder (m)
//   tones     range of leaf tints (linear RGB multipliers); the oak's leaf
//             texture is much darker than the others', so it is lifted
//   bark      bark brightness multiplier
export const SPECIES = {
  birch: { sway: 0.33, flutter: 1, trunk: 0.25, crown: 3.2, shade: 0.75, spacing: 4.5, bark: 1, tones: [[0.88, 1, 0.86], [1.08, 1.06, 0.84]] },
  eucalyptus: { sway: 0.13, flutter: 0.8, trunk: 0.45, crown: 3.8, shade: 0.55, spacing: 5.5, bark: 1, tones: [[0.86, 0.98, 0.94], [1.06, 1.04, 0.9]] },
  mate: { sway: 0.9, flutter: 0.8, trunk: 0.16, crown: 2, shade: 0.7, spacing: 3.5, bark: 1.1, tones: [[1, 1.08, 0.98], [1.16, 1.16, 0.95]] },
  oak: { sway: 0.12, flutter: 0.6, trunk: 0.6, crown: 7, shade: 1, spacing: 9, bark: 1.8, tones: [[1.45, 1.5, 1.3], [1.75, 1.65, 1.25]] },
};
const MAX_TREES = 1400;

// Billboards are a few flat cards; lit by their own normals, cards facing
// away from the sun turn dark. Light them like a rounded crown facing the
// viewer instead, which is how a whole tree reads from a distance.
const BILLBOARD_NORMAL = /* glsl */ `
vec3 btToCam = cameraPosition - ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
btToCam.y = 0.0;
vec3 btCrownN = normalize( normalize( btToCam + vec3( 1e-3, 0.0, 0.0 ) ) * 0.75 + vec3( 0.0, 0.65, 0.0 ) );
vec3 objectNormal = normalize( transpose( mat3( instanceMatrix ) ) * btCrownN );
`;

// Loads every species: { birch: [{ name, parts: [{ geometry, map, kind }], far }], ..., deadwood: [...] }.
export async function loadTreeModels(anisotropy) {
  const loader = new GLTFLoader();
  const names = [...Object.keys(SPECIES), 'deadwood'];
  const files = await Promise.all(names.map((n) => loader.loadAsync(`${import.meta.env.BASE_URL}models/trees/${n}.glb`)));
  const models = {};
  names.forEach((name, i) => {
    const variants = new Map();
    for (const node of files[i].scene.children) {
      const far = node.name.endsWith('_far');
      const id = far ? node.name.slice(0, -4) : node.name;
      if (!variants.has(id)) variants.set(id, { name: id, parts: [], far: null });
      const v = variants.get(id);
      for (const mesh of node.isMesh ? [node] : node.children.filter((c) => c.isMesh)) {
        const map = mesh.material.map;
        map.anisotropy = anisotropy;
        mesh.geometry.computeBoundingBox();
        if (far) v.far = { geometry: mesh.geometry, map };
        else v.parts.push({ geometry: mesh.geometry, map, kind: /leaves/.test(mesh.material.name) ? 'leaves' : 'bark' });
      }
    }
    models[name] = [...variants.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  return models;
}

// Eucalyptus in the warm lowlands, oaks on open low ground, birches up the
// hills, yerba mate as understorey and along the forest edges.
function pickSpecies(h, forest, r) {
  const w = {
    eucalyptus: 1 - smoothstep(8, 18, h),
    oak: (1 - smoothstep(16, 28, h)) * (0.35 + 0.5 * (1 - forest)),
    birch: 0.1 + 1.2 * smoothstep(10, 24, h),
    mate: 0.3 + 0.4 * (1 - forest),
  };
  let pick = r * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [species, weight] of Object.entries(w)) if ((pick -= weight) <= 0) return species;
  return 'birch';
}

// Trees grow where the forest floor is (same map), plus a few lone trees in
// the open, above the reach of today's sea.
export function placeTrees(terrain, rng, colliders, spacingOk) {
  const trees = [];
  for (let k = 0; k < 60000 && trees.length < MAX_TREES; k++) {
    const x = range(rng, -330, 330), z = range(rng, -330, 330);
    const h = terrain.heightAt(x, z);
    if (h < 3.4 || h > 44 || terrain.slopeAt(x, z) > 0.16) continue;
    const forest = smoothstep(-0.12, 0.3, terrain.forestDensity(x, z)) * (1 - smoothstep(30, 40, h));
    if (rng() > forest * 0.95 + 0.03) continue;
    const species = pickSpecies(h, forest, rng());
    const sp = SPECIES[species];
    const s = range(rng, 0.85, 1.15);
    if (!spacingOk(x, z, sp.spacing * s)) continue;
    trees.push({ species, x, y: h - 0.2, z, rot: rng() * Math.PI * 2, s, sy: range(rng, 0.94, 1.08), tone: rng(), variant: Math.floor(rng() * 3) });
    colliders.add(x, z, sp.trunk * s);
  }
  return trees;
}

// Draws the trees: full 3D trees near the camera and billboards beyond,
// dithering into each other over the band. Both lists are rebuilt nearest
// first as you move, so leaves and billboards hidden behind nearer ones
// fail the depth test instead of being shaded (dense forest stacks many).
export function createForest(scene, models, trees, { quality, cloudShadows }) {
  const { near: nearRadius, band, far: farRadius } = quality.trees;
  const fade = [nearRadius - band, nearRadius];
  const shadows = quality.shadowMap > 0;
  const msaa = quality.antialias;
  const variants = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), tone = new THREE.Color(), toneA = new THREE.Color(), toneB = new THREE.Color();

  for (const [name, sp] of Object.entries(SPECIES)) {
    // Bark and leaf textures are shared by all of a species' variants.
    const barkMap = models[name][0].parts.find((part) => part.kind === 'bark').map;
    const leafMap = models[name][0].parts.find((part) => part.kind === 'leaves').map;
    const barkMat = patchMaterial(
      new THREE.MeshLambertMaterial({ map: barkMap, color: new THREE.Color().setScalar(sp.bark), side: THREE.DoubleSide }),
      { key: `tree-bark-${name}`, sway: sp.sway, snowMin: 0.9, cloudShadows, fadeOut: fade, tree: 'bark' },
    );
    const leafMat = patchMaterial(
      new THREE.MeshLambertMaterial({ map: leafMap, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: msaa }),
      { key: `tree-leaves-${name}`, sway: sp.sway, flutter: sp.flutter, foliage: 0.8, dry: true, snowMin: 0.5, cloudShadows, hardShadow: true, fadeOut: fade, tree: 'leaves' },
    );
    const barkDepth = foliageDepthMaterial({ key: `tree-bark-${name}`, sway: sp.sway, tree: 'bark' });
    const leafDepth = foliageDepthMaterial({ key: `tree-leaves-${name}`, map: leafMap, alphaTest: 0.5, sway: sp.sway, flutter: sp.flutter, tree: 'leaves' });
    toneA.setRGB(...sp.tones[0]);
    toneB.setRGB(...sp.tones[1]);

    models[name].forEach((model, vi) => {
      const list = trees.filter((t) => t.species === name && t.variant === vi);
      const n = Math.max(1, list.length);
      // Each tree's placement and tint, ready to copy into the near meshes.
      const treeMatrices = new Float32Array(n * 16), treeTones = new Float32Array(n * 3);
      list.forEach((t, i) => {
        m.compose(p.set(t.x, t.y, t.z), q.setFromAxisAngle(up, t.rot), sc.set(t.s, t.s * t.sy, t.s)).toArray(treeMatrices, i * 16);
        tone.copy(toneA).lerp(toneB, t.tone).toArray(treeTones, i * 3);
        t.index = i;
      });

      // Near: all parts share one matrix buffer; leaves get the tint.
      const matrices = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16).setUsage(THREE.DynamicDrawUsage);
      const colors = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const meshes = model.parts.map((part) => {
        const leaves = part.kind === 'leaves';
        const mesh = new THREE.InstancedMesh(part.geometry, leaves ? leafMat : barkMat, n);
        mesh.instanceMatrix = matrices;
        if (leaves) mesh.instanceColor = colors;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        mesh.customDepthMaterial = leaves ? leafDepth : barkDepth;
        // Leaves after the trunk, so leaves behind it fail the depth test.
        mesh.renderOrder = leaves ? 1 : 0;
        scene.add(mesh);
        return mesh;
      });

      // Far: every tree's billboard, invisible inside the near radius.
      const farMat = patchMaterial(
        new THREE.MeshLambertMaterial({ map: model.far.map, alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: msaa }),
        {
          key: `tree-far-${model.name}`, sway: sp.sway, foliage: 0.5, dry: true, snowMin: 0.5, cloudShadows, fadeIn: fade, tree: 'bark',
          custom: { beginNormal: BILLBOARD_NORMAL },
        },
      );
      const far = new THREE.InstancedMesh(model.far.geometry, farMat, n);
      far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      far.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
      far.count = 0;
      far.frustumCulled = false;
      scene.add(far);

      variants.push({ trees: list, treeMatrices, treeTones, matrices, colors, meshes, far });
    });
  }

  // Copies the listed trees, nearest first, into an instance buffer pair.
  const write = (v, list, matrices, colors) => {
    list.sort((a, b) => a.d2 - b.d2);
    list.forEach((t, i) => {
      matrices.array.set(v.treeMatrices.subarray(t.index * 16, t.index * 16 + 16), i * 16);
      colors.array.set(v.treeTones.subarray(t.index * 3, t.index * 3 + 3), i * 3);
    });
    matrices.needsUpdate = true;
    colors.needsUpdate = true;
    return list.length;
  };

  const nearList = [], farList = [];
  const last = new THREE.Vector2(Infinity, Infinity);
  return {
    count: trees.length,
    update(camera) {
      const cx = camera.position.x, cz = camera.position.z;
      if ((cx - last.x) ** 2 + (cz - last.y) ** 2 < 4) return;
      last.set(cx, cz);
      const near2 = (nearRadius + 2) ** 2;
      const farMin2 = Math.max(0, nearRadius - band - 2) ** 2, farMax2 = farRadius ** 2;
      for (const v of variants) {
        nearList.length = 0;
        farList.length = 0;
        for (const t of v.trees) {
          t.d2 = (t.x - cx) ** 2 + (t.z - cz) ** 2;
          if (t.d2 <= near2) nearList.push(t);
          if (t.d2 >= farMin2 && t.d2 <= farMax2) farList.push(t);
        }
        const nearCount = write(v, nearList, v.matrices, v.colors);
        for (const mesh of v.meshes) mesh.count = nearCount;
        v.far.count = write(v, farList, v.far.instanceMatrix, v.far.instanceColor);
      }
    },
  };
}
