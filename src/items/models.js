import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ITEMS } from './items.js';

// Low-poly item models, coloured per vertex so every item can share one
// material: lying in the world (gathering.js) and held in your hand
// (player/heldItem.js).

const WOOD = '#7a5a3a', STONE = '#8a8780';

function paint(geometry, hex) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

// Tools stand up: the grip is at the origin and the handle runs up +Y.
const TOOLS = {
  knife: () => [
    paint(new THREE.CylinderGeometry(0.016, 0.019, 0.15, 6).translate(0, 0.075, 0), WOOD),
    paint(new THREE.ConeGeometry(0.028, 0.15, 4).scale(1, 1, 0.35).translate(0, 0.22, 0), STONE),
  ],
  axe: () => [
    paint(new THREE.CylinderGeometry(0.018, 0.022, 0.5, 6).translate(0, 0.25, 0), WOOD),
    paint(new THREE.DodecahedronGeometry(0.06).scale(1.5, 0.85, 0.45).translate(0.05, 0.45, 0), STONE),
  ],
  pickaxe: () => [
    paint(new THREE.CylinderGeometry(0.018, 0.022, 0.5, 6).translate(0, 0.25, 0), WOOD),
    paint(new THREE.ConeGeometry(0.03, 0.2, 5).rotateZ(-Math.PI / 2).translate(0.1, 0.47, 0), STONE),
    paint(new THREE.ConeGeometry(0.03, 0.2, 5).rotateZ(Math.PI / 2).translate(-0.1, 0.47, 0), STONE),
  ],
};

export const isTool = (id) => !!TOOLS[id];

// A tool standing up in your hand.
export function toolGeometry(id) {
  return mergeGeometries(TOOLS[id]());
}

// An item lying on the ground, centred on the origin.
export function lyingGeometry(id) {
  if (TOOLS[id]) {
    const g = toolGeometry(id).rotateZ(-Math.PI / 2);
    g.computeBoundingBox();
    const box = g.boundingBox;
    return g.translate(-(box.min.x + box.max.x) / 2, 0, 0);
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
export const REST = { stick: 0.03, stone: 0.06, fibre: 0.05, berries: 0.04, knife: 0.03, axe: 0.05, pickaxe: 0.04 };
