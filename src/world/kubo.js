import * as THREE from 'three';
import { mulberry32 } from '../shared.js';
import { patchMaterial } from './materials.js';

// The bahay kubo's materials, drawn once at startup (the game ships no
// images for them): bamboo for its stilts, poles and frames, woven bamboo
// strips (sawali) for its walls, split bamboo for its floor and nipa thatch
// for its roof. building.js builds the house itself.

function canvasTexture(width, height, anisotropy, seed, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), mulberry32(seed));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  return texture;
}

// A bamboo pole's skin, round it (across) and along it (down): straw
// green-gold with faint streaks, and a ridged node every so often.
function drawBamboo(ctx, r) {
  const W = 64, H = 256;
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, '#a9a35a');
  g.addColorStop(0.5, '#cdbf72');
  g.addColorStop(1, '#a29a55');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '90, 80, 30' : '240, 225, 160'}, ${0.06 + r() * 0.1})`;
    ctx.fillRect(r() * W, 0, 1 + r() * 2, H);
  }
  for (const y of [40, 128, 216]) {
    ctx.fillStyle = 'rgba(80, 66, 28, 0.55)';
    ctx.fillRect(0, y - 3, W, 6);
    ctx.fillStyle = 'rgba(245, 230, 170, 0.45)';
    ctx.fillRect(0, y + 3, W, 2);
  }
}

// Sawali: thin bamboo strips woven over and under in a herringbone.
function drawSawali(ctx, r) {
  const W = 256, H = 64, S = 8;
  ctx.fillStyle = '#b89a62';
  ctx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += S) {
    for (let x = 0; x < W; x += S) {
      const over = ((x / S) + Math.floor(y / S / 3)) % 2 === 0;
      const tone = 0.82 + r() * 0.3;
      ctx.fillStyle = over ? `rgb(${226 * tone | 0}, ${198 * tone | 0}, ${138 * tone | 0})` : `rgb(${170 * tone | 0}, ${140 * tone | 0}, ${88 * tone | 0})`;
      if (over) ctx.fillRect(x, y + 1, S - 1, S * 3 - 2);
      else ctx.fillRect(x + 1, y, S - 2, S - 1);
    }
  }
  ctx.strokeStyle = 'rgba(70, 50, 22, 0.35)';
  for (let y = 0; y <= H; y += S * 3) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

// Split bamboo floor slats: long strips with nodes, gaps between them.
function drawSlats(ctx, r) {
  const W = 256, H = 64, n = 6;
  ctx.fillStyle = '#4a3a1e';
  ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < n; k++) {
    const y = (k * H) / n, h = H / n - 1.5, tone = 0.85 + r() * 0.25;
    ctx.fillStyle = `rgb(${205 * tone | 0}, ${178 * tone | 0}, ${108 * tone | 0})`;
    ctx.fillRect(0, y + 0.75, W, h);
    for (let x = 30 + r() * 40; x < W; x += 70 + r() * 30) {
      ctx.fillStyle = 'rgba(90, 70, 30, 0.5)';
      ctx.fillRect(x, y + 0.75, 3, h);
    }
  }
}

// Nipa thatch: rows of drooping palm-leaf strands, lighter at the tips,
// each row lapping over the one below.
function drawThatch(ctx, r) {
  const W = 256, H = 64;
  ctx.fillStyle = '#6e5a36';
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 900; i++) {
    const x = r() * W, y = r() * H * 0.9, len = 10 + r() * 22;
    const tone = 0.7 + r() * 0.5;
    ctx.strokeStyle = `rgb(${168 * tone | 0}, ${138 * tone | 0}, ${84 * tone | 0})`;
    ctx.lineWidth = 1 + r() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 4, y + len);
    ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(40, 30, 14, 0.45)');
  g.addColorStop(0.25, 'rgba(40, 30, 14, 0)');
  g.addColorStop(1, 'rgba(255, 240, 200, 0.12)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// { bamboo, sawali, slat, thatch }: lit and weathered like the world.
export function createKuboMaterials({ anisotropy, cloudShadows }) {
  const make = (name, w, h, seed, draw) => patchMaterial(
    new THREE.MeshLambertMaterial({ map: canvasTexture(w, h, anisotropy, seed, draw) }),
    { key: `kubo-${name}`, snowMin: 0.6, cloudShadows },
  );
  return {
    bamboo: make('bamboo', 64, 256, 71, drawBamboo),
    sawali: make('sawali', 256, 64, 72, drawSawali),
    slat: make('slat', 256, 64, 73, drawSlats),
    thatch: make('thatch', 256, 64, 74, drawThatch),
  };
}
