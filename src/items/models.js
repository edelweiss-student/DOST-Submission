import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ITEMS } from './items.js';

// Item models, coloured per vertex so every item can share one material:
// lying in the world (gathering.js) and held in your hand
// (player/heldItem.js). The tools are Kay Lousberg's KayKit models (CC0),
// packed by scripts/import-tools.mjs into public/models/tools.glb: each
// stands on its grip at the origin, handle up +Y and head towards +X. The
// spear and the rest are simple shapes made here.

const TOOLS = ['knife', 'axe', 'pickaxe', 'spear'];
let tools = null;

// Loads the tool models; wait for it before using any of them.
export async function loadToolModels() {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/tools.glb`);
  tools = Object.fromEntries(gltf.scene.children.map((mesh) => [mesh.name, mesh.geometry]));
}

export const isTool = (id) => TOOLS.includes(id);

// A tool standing up in your hand.
export function toolGeometry(id) {
  return id === 'spear' ? spearGeometry() : tools[id].clone();
}

// The spear: a 1.6 m shaft gripped at the origin a little behind its middle,
// running up +Y to a flaked stone point lashed on with fibre. SPEAR_TIP: how
// far up +Y its point reaches.
export const SPEAR_TIP = 1.18;
export function spearGeometry() {
  return mergeGeometries([
    paint(new THREE.CylinderGeometry(0.019, 0.023, 1.6, 6).translate(0, 0.16, 0), '#8a6440'),
    paint(new THREE.CylinderGeometry(0.03, 0.028, 0.09, 6).translate(0, 0.92, 0), '#9bb04a'),
    paint(new THREE.OctahedronGeometry(0.05, 0).scale(1, 2.6, 0.45).translate(0, 1.05, 0), '#8a8780'),
  ]);
}

function paint(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// An item lying on the ground, centred on the origin with its underside
// REST below it.
export function lyingGeometry(id) {
  if (isTool(id)) {
    // On its side: the handle along X, the head lying flat.
    const g = toolGeometry(id).rotateZ(-Math.PI / 2).rotateX(Math.PI / 2);
    g.computeBoundingBox();
    const box = g.boundingBox;
    return g.translate(-(box.min.x + box.max.x) / 2, -box.min.y - REST[id], -(box.min.z + box.max.z) / 2);
  }
  const color = ITEMS[id].color;
  switch (id) {
    case 'stick': return paint(new THREE.CylinderGeometry(0.025, 0.03, 0.6, 5).rotateZ(Math.PI / 2), color);
    case 'stone': return paint(new THREE.DodecahedronGeometry(0.08).scale(1, 0.75, 0.9), color);
    case 'fibre': return paint(new THREE.CylinderGeometry(0.05, 0.035, 0.32, 6).rotateZ(Math.PI / 2), color);
    default: return mergeGeometries([[0, 0, 0], [0.06, 0.01, 0.03], [0.02, 0.05, -0.04]].map(
      ([x, y, z]) => paint(new THREE.IcosahedronGeometry(0.04, 1).translate(x, y, z), color)));
  }
}

// How far above the ground each item's centre rests (m).
export const REST = { stick: 0.03, stone: 0.06, fibre: 0.05, berries: 0.04, knife: 0.02, axe: 0.03, pickaxe: 0.03, spear: 0.03 };
