import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { WORLD, smoothstep, lerp, clamp } from '../shared.js';
import { patchMaterial, terrainSplat } from './materials.js';

const CONTROL_SIZE = 512;   // biome map texels per side (about 1.4 m each)

// Procedural island: forest interior, a central peak, beaches, a reef
// shelf, a small islet, and deep ocean falling off to the abyss.
export function createTerrain(rng, { ground, cloudShadows = false, castShadow = false } = {}) {
  const simplex = new SimplexNoise({ random: rng });
  const n2 = (x, z, f) => simplex.noise(x * f, z * f);
  const fbm = (x, z, f, octaves) => {
    let amp = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n2(x, z, f);
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  };

  const peak = { x: lerp(-50, 50, rng()), z: lerp(-50, 50, rng()) };
  const isletAngle = rng() * Math.PI * 2;
  const islet = { x: Math.cos(isletAngle) * 255, z: Math.sin(isletAngle) * 255, r: 46 };

  function rawHeight(x, z) {
    let d = Math.hypot(x, z) / WORLD.islandRadius;
    d += n2(x, z, 0.006) * 0.18 + n2(x, z, 0.02) * 0.05;
    const di = Math.hypot(x - islet.x, z - islet.z) / islet.r + n2(x + 100, z, 0.03) * 0.15;
    const land = Math.max(1 - smoothstep(0.55, 1.0, d), 1 - smoothstep(0.45, 1.0, di));

    const inner = 1 - smoothstep(0.3, 0.85, d);
    const hills = (fbm(x, z, 0.008, 4) * 0.5 + 0.5) * 22 * (0.2 + 0.8 * inner) + 2.5;
    const pd = Math.hypot(x - peak.x, z - peak.z) / 95;
    const mountain = Math.pow(Math.max(0, 1 - pd), 2) * 34 * (0.85 + 0.15 * n2(x, z, 0.05));
    let landH = hills + mountain;
    // Small rolls and hummocks inland; beaches stay smooth.
    landH += fbm(x - 70, z + 40, 0.06, 3) * 0.8 * smoothstep(3, 7, landH);

    const oceanT = Math.min(smoothstep(1.0, 1.6, d), smoothstep(1.0, 2.2, di));
    const shelf = -5 + n2(x, z, 0.015) * 2.5 + n2(x, z, 0.05) * 0.8;
    const deep = -36 + n2(x, z, 0.008) * 7;
    const h = lerp(lerp(shelf, deep, oceanT), landH, land);

    const edge = Math.max(Math.abs(x), Math.abs(z)) / (WORLD.size / 2);
    return lerp(h, WORLD.abyssDepth + 3, smoothstep(0.86, 1.0, edge));
  }

  const N = WORLD.segments;
  const step = WORLD.size / N;
  const half = WORLD.size / 2;
  const heights = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      heights[i + j * (N + 1)] = rawHeight(-half + i * step, -half + j * step);
    }
  }
  const H = (i, j) => heights[clamp(i, 0, N) + clamp(j, 0, N) * (N + 1)];

  // Exact height of the triangulated surface (matches the mesh below).
  function heightAt(x, z) {
    const gx = clamp((x + half) / step, 0, N - 1e-4);
    const gz = clamp((z + half) / step, 0, N - 1e-4);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const h00 = H(i, j), h10 = H(i + 1, j), h01 = H(i, j + 1), h11 = H(i + 1, j + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  function slopeAt(x, z) {
    const e = 1.5;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return 1 - 1 / Math.sqrt(1 + dx * dx + dz * dz); // 0 flat .. 1 vertical
  }

  const forestDensity = (x, z) => n2(x, z, 0.012) * 0.6 + n2(x, z, 0.045) * 0.4;

  // --- Mesh: a smooth indexed grid with normals from the height field.
  const V = N + 1;
  const positions = new Float32Array(V * V * 3);
  const normals = new Float32Array(V * V * 3);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const o = (i + j * V) * 3;
      positions[o] = -half + i * step;
      positions[o + 1] = H(i, j);
      positions[o + 2] = -half + j * step;
      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      normals[o] = -dx * inv;
      normals[o + 1] = inv;
      normals[o + 2] = -dz * inv;
    }
  }
  const index = new Uint32Array(N * N * 6);
  let k = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = i + j * V, b = a + 1, c = a + V, d = c + 1;
      index[k++] = a; index[k++] = c; index[k++] = b;   // same split as heightAt
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  // --- Biome map: R forest floor, G canopy (filled in by the
  // vegetation), B grass density for the 3D grass.
  const C = CONTROL_SIZE;
  const cstep = WORLD.size / C;
  const control = new Uint8Array(C * C * 4);
  const canopy = new Float32Array(C * C);
  for (let j = 0; j < C; j++) {
    for (let i = 0; i < C; i++) {
      const x = -half + (i + 0.5) * cstep, z = -half + (j + 0.5) * cstep;
      const h = heightAt(x, z);
      const f = forestDensity(x, z);
      const forest = smoothstep(-0.12, 0.3, f) * (1 - smoothstep(30, 40, h));
      const slope = slopeAt(x, z);
      const meadow = (1 - forest * 0.8) * smoothstep(2.3, 3.4, h) * (1 - smoothstep(0.14, 0.24, slope))
        * (0.55 + 0.45 * smoothstep(-0.5, 0.3, n2(x + 500, z, 0.03)));
      const o = (i + j * C) * 4;
      control[o] = Math.round(forest * 255);
      control[o + 2] = Math.round(clamp(meadow, 0, 1) * 255);
      control[o + 3] = 255;
    }
  }
  const controlTex = new THREE.DataTexture(control, C, C, THREE.RGBAFormat);
  controlTex.magFilter = THREE.LinearFilter;
  controlTex.minFilter = THREE.LinearFilter;
  controlTex.needsUpdate = true;
  const controlRect = new THREE.Vector3(-half, -half, 1 / WORLD.size);

  // Plants (bushes for now) darken the ground below them (ambient
  // occlusion, and a stand-in for their shadows past the shadow map's range).
  function addCanopy(x, z, radius, strength = 1) {
    const ci = (x + half) / cstep - 0.5, cj = (z + half) / cstep - 0.5;
    const r = radius / cstep;
    for (let j = Math.max(0, Math.floor(cj - r)); j <= Math.min(C - 1, Math.ceil(cj + r)); j++) {
      for (let i = Math.max(0, Math.floor(ci - r)); i <= Math.min(C - 1, Math.ceil(ci + r)); i++) {
        const d = Math.hypot(i - ci, j - cj) / r;
        if (d < 1) canopy[i + j * C] += strength * (1 - d * d);
      }
    }
  }
  function commitCanopy() {
    for (let p = 0; p < C * C; p++) {
      const c = Math.min(1, canopy[p] * 0.8);
      control[p * 4 + 1] = Math.round(c * 255);
      // Little grass grows in deep shade.
      control[p * 4 + 2] = Math.round(control[p * 4 + 2] * (1 - 0.85 * c));
    }
    controlTex.needsUpdate = true;
  }

  const material = patchMaterial(
    new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }),
    {
      key: 'terrain', dry: true, caustics: true, snowMin: 0.6, cloudShadows,
      terrain: terrainSplat(ground, controlTex, controlRect, new THREE.Vector4(1 / 3, 1 / 2.5, 1 / 3, 1 / 4.5)),
    },
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  mesh.castShadow = castShadow;

  // Heights as a texture, so shaders know the ground (water depth, grass).
  const heightData = new Uint16Array(V * V);
  for (let i = 0; i < heightData.length; i++) heightData[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const heightTexture = new THREE.DataTexture(heightData, V, V, THREE.RedFormat, THREE.HalfFloatType);
  heightTexture.minFilter = heightTexture.magFilter = THREE.LinearFilter;
  heightTexture.needsUpdate = true;

  // A beach point on the main island, facing the sea.
  function findSpawn() {
    const start = rng() * Math.PI * 2;
    for (let k = 0; k < 48; k++) {
      const ang = start + (k / 48) * Math.PI * 2;
      for (let r = 300; r > 20; r -= 2) {
        const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
        if (Math.hypot(x - islet.x, z - islet.z) < islet.r * 2.4) break;
        if (heightAt(x, z) > 1.2) {
          const sx = Math.cos(ang) * (r - 8), sz = Math.sin(ang) * (r - 8);
          if (slopeAt(sx, sz) < 0.08 && heightAt(sx, sz) < 6) {
            return { x: sx, z: sz, yaw: Math.atan2(-Math.cos(ang), -Math.sin(ang)) };
          }
          break;
        }
      }
    }
    return { x: 0, z: 0, yaw: 0 };
  }

  return {
    mesh, heightAt, slopeAt, forestDensity, findSpawn, islet, peak, addCanopy, commitCanopy,
    controlTexture: controlTex, controlRect, heightTexture,
    // Raw height grid: size x size samples, step metres apart, starting at -half.
    grid: { heights, size: V, step, half },
  };
}
