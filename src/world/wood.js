import * as THREE from 'three';
import { mulberry32 } from '../shared.js';
import { patchMaterial } from './materials.js';
import { SPECIES } from './trees.js';

// Wood in the world: logs (from felled trees and fallen trunks), the
// planks split from them, stumps, and what's built with the planks (see
// timber.js and building.js). Bark comes from the tree models; the plank
// grain and the rings on cut ends are drawn here (the game ships no other
// images).

export const LOG_LENGTH = 2.2;
// Logs are thinner or thicker by the tree they came from (m).
export const LOG_RADIUS = { birch: 0.16, eucalyptus: 0.2, mate: 0.12, oak: 0.24, deadwood: 0.22 };
export const PLANK = { length: 2.1, width: 0.32, thick: 0.07 };
export const PLANKS_PER_LOG = 4;

function canvasTexture(width, height, anisotropy, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  draw(ctx, mulberry32(width * 7 + height));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}

// Sawn wood along the grain: long wavy lines, a knot or two, darker edges.
function drawGrain(ctx, r) {
  const W = 256, H = 64;
  ctx.fillStyle = '#b08154';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 46; i++) {
    const y0 = r() * H, amp = 0.5 + r() * 2.5, freq = 0.01 + r() * 0.03, ph = r() * 6.28;
    ctx.strokeStyle = r() < 0.75 ? `rgba(92, 56, 26, ${0.08 + r() * 0.22})` : `rgba(240, 205, 150, ${0.08 + r() * 0.12})`;
    ctx.lineWidth = 0.6 + r() * 1.8;
    ctx.beginPath();
    for (let x = -4; x <= W + 4; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp;
      if (x < 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let k = 0; k < 2; k++) {
    const x = 40 + r() * 170, y = 14 + r() * 36;
    for (let j = 4; j >= 1; j--) {
      ctx.fillStyle = `rgba(${70 + j * 12}, ${40 + j * 8}, ${18 + j * 4}, 0.5)`;
      ctx.beginPath();
      ctx.ellipse(x, y, j * 3.2, j * 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(60, 34, 14, 0.45)';
  ctx.fillRect(0, 0, W, 2);
  ctx.fillRect(0, H - 2, W, 2);
}

// A cut end: growth rings round the pith, a crack, and the bark around the edge.
function drawRings(ctx, r) {
  const S = 128, c = S / 2;
  const g = ctx.createRadialGradient(c, c, 2, c, c, c);
  g.addColorStop(0, '#c99a62');
  g.addColorStop(0.85, '#dcb37c');
  g.addColorStop(1, '#b8895a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  for (let rad = 4; rad < c - 6; rad += 3 + r() * 4) {
    ctx.strokeStyle = `rgba(120, 74, 36, ${0.25 + r() * 0.3})`;
    ctx.lineWidth = 0.8 + r();
    ctx.beginPath();
    ctx.arc(c + (r() - 0.5) * 2, c + (r() - 0.5) * 2, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(70, 40, 18, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c + 30, c - 34);
  ctx.stroke();
  ctx.strokeStyle = '#4a321e';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(c, c, c - 3.5, 0, Math.PI * 2);
  ctx.stroke();
}

// Every wood material, made once: bark per kind of log (each tree species,
// plus the deadwood's), cut ends, planks, and blueprints.
export function createWoodMaterials(treeModels, { anisotropy, cloudShadows }) {
  const endGrain = patchMaterial(
    new THREE.MeshLambertMaterial({ map: canvasTexture(128, 128, anisotropy, drawRings) }),
    { key: 'end-grain', snowMin: 0.6, cloudShadows },
  );
  const plank = patchMaterial(
    new THREE.MeshLambertMaterial({ map: canvasTexture(256, 64, anisotropy, drawGrain) }),
    { key: 'planks', snowMin: 0.6, cloudShadows },
  );
  // Bark as bright as on the standing trees (see SPECIES.bark in trees.js).
  const barks = Object.fromEntries(Object.keys(SPECIES).map((name) => [name, {
    map: treeModels[name][0].parts.find((part) => part.kind === 'bark').map, brightness: SPECIES[name].bark,
  }]));
  barks.deadwood = { map: treeModels.deadwood[0].parts[0].map, brightness: 1.5 };
  const bark = Object.fromEntries(Object.entries(barks).map(([name, { map, brightness }]) => [name, patchMaterial(
    new THREE.MeshLambertMaterial({ map, color: new THREE.Color().setScalar(brightness) }),
    { key: `log-bark-${name}`, snowMin: 0.6, cloudShadows },
  )]));
  // Blueprints: what's still to be built, see-through.
  const ghost = new THREE.MeshBasicMaterial({ color: '#d5ecff', transparent: true, opacity: 0.22, depthWrite: false, fog: false });
  return { endGrain, plank, bark, ghost };
}

// A log lying along +X, one unit long and one unit in radius (scaled per
// instance), bark round the side (material 0) and cut ends (1 and 2).
export function logGeometry() {
  const radial = 10;
  const g = new THREE.CylinderGeometry(1, 1, 1, radial, 1).rotateZ(-Math.PI / 2);
  // Bark repeats about every metre and a bit along a log.
  const uv = g.attributes.uv;
  for (let i = 0; i < (radial + 1) * 2; i++) uv.setY(i, uv.getY(i) * LOG_LENGTH / 1.2);
  return g;
}

// A board along +X, one unit each way (scaled per instance to a plank or a
// building part), so the grain runs along its length.
export const boardGeometry = () => new THREE.BoxGeometry(1, 1, 1);
