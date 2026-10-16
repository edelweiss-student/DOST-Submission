import * as THREE from 'three';
import { uniforms, mulberry32, range, clamp, smoothstep } from '../shared.js';
import { Waves, shoalFactor } from './waves.js';
import { waterVertex, waterFragment } from './waterShaders.js';

const RADIUS = 1300;
const SHALLOW_TINT = new THREE.Color('#3fc6c0');

// Water quality presets: grid resolution, wind-wave components (two swell
// components are always added) and ripple texture samples per pixel.
export const WATER_QUALITY = {
  low: { label: 'Low', grid: 128, windWaves: 4, detail: 1 },
  medium: { label: 'Medium', grid: 192, windWaves: 7, detail: 2 },
  high: { label: 'High', grid: 256, windWaves: 10, detail: 2 },
};

// n x n grid that follows the camera: ~0.6 m cells underfoot, ~40 m at the
// horizon, so detail goes where it can be seen.
function taperedGrid(n) {
  const coord = (i) => {
    const u = (i / (n - 1)) * 2 - 1;
    return RADIUS * (0.04 * u + 0.96 * u * u * u);
  };
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 3;
      pos[o] = coord(i);
      pos[o + 2] = coord(j);
    }
  }
  const index = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setIndex(index);
  return geometry;
}

// Tiling ripple normals (RG) plus a foam pattern (A), built from sine
// components with whole-number frequencies so the texture wraps seamlessly.
function detailTexture(renderer, size = 256) {
  const rng = mulberry32(7);
  const components = (count, maxF) => Array.from({ length: count }, () => {
    let fx = 0, fy = 0;
    while (fx === 0 && fy === 0) {
      fx = Math.round(range(rng, -maxF, maxF));
      fy = Math.round(range(rng, -maxF, maxF));
    }
    return { fx, fy, amp: 1 / Math.hypot(fx, fy), ph: rng() * Math.PI * 2 };
  });
  const ripples = components(24, 9);
  const foam = components(18, 14);
  const slopeScale = 0.35 / Math.sqrt(ripples.length / 4);
  const foamScale = 0.5 / (2.2 * Math.sqrt(foam.reduce((s, w) => s + w.amp * w.amp / 2, 0)));

  const data = new Uint8Array(size * size * 4);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let gx = 0, gy = 0, f = 0;
      for (const w of ripples) {
        const c = Math.cos(TAU * (w.fx * u + w.fy * v) + w.ph) * w.amp;
        gx += c * w.fx;
        gy += c * w.fy;
      }
      for (const w of foam) f += Math.sin(TAU * (w.fx * u + w.fy * v) + w.ph) * w.amp;
      const o = (y * size + x) * 4;
      data[o] = Math.round((clamp(-gx * slopeScale, -1, 1) * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((clamp(-gy * slopeScale, -1, 1) * 0.5 + 0.5) * 255);
      data[o + 2] = 255;
      data[o + 3] = Math.round(clamp(f * foamScale + 0.5, 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
  return tex;
}

export function createWater(scene, terrain, renderer, qualityName) {
  const grid = terrain.grid;
  const u = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...uniforms, // sky, clouds and light direction are shared with the rest of the world
    uTime: uniforms.uTime,
    uSeaLevel: uniforms.uWaterLevel,
    uWaveA: { value: [] },
    uWaveB: { value: [] },
    uEnvA: { value: new THREE.Vector4() },
    uEnvB: { value: new THREE.Vector4() },
    uGroupStrength: { value: 0 },
    uRogue: { value: new THREE.Vector4() },
    uRogueDir: { value: new THREE.Vector2(1, 0) },
    uDrift: { value: new THREE.Vector2() },
    uGustiness: { value: 0 },
    uBreakDepth: { value: 0.5 },
    uCamPos: { value: new THREE.Vector3() },
    uHeightMap: { value: terrain.heightTexture },
    uHeightRect: { value: new THREE.Vector3(-grid.half - grid.step / 2, -grid.half - grid.step / 2, 1 / (grid.size * grid.step)) },
    uDetail: { value: detailTexture(renderer) },
    uSunColor: { value: new THREE.Color() },
    uSunVis: { value: 1 },
    uDeep: { value: new THREE.Color() },
    uShallow: { value: new THREE.Color() },
    uLight: { value: 1 },
    uFlash: { value: 0 },
    uChop: { value: 0.2 },
    uFoam: { value: 0 },
    uAmpTotal: { value: 1 },
  };

  const api = { mesh: null, waves: null, quality: null, setQuality, surface, update };

  // (Re)build the surface for a quality preset; the sea state carries over.
  function setQuality(name) {
    const quality = WATER_QUALITY[name] ? name : 'medium';
    const preset = WATER_QUALITY[quality];
    const waves = new Waves(preset.windWaves);
    if (api.waves) waves.windSpeed = api.waves.windSpeed;
    u.uWaveA.value = waves.uniformA;
    u.uWaveB.value = waves.uniformB;

    const material = new THREE.ShaderMaterial({
      defines: { NUM_WAVES: waves.count, DETAIL_SAMPLES: preset.detail },
      uniforms: u,
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      transparent: true,
      side: THREE.DoubleSide,
      fog: true,
    });
    if (api.mesh) {
      scene.remove(api.mesh);
      api.mesh.geometry.dispose();
      api.mesh.material.dispose();
    }
    const mesh = new THREE.Mesh(taperedGrid(preset.grid), material);
    mesh.name = 'water';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    Object.assign(api, { mesh, waves, quality });
  }

  // Water surface for physics: absolute height, water velocity and slope at (x, z).
  const scratch = {};
  function surface(x, z, t, out = scratch) {
    const sea = uniforms.uWaterLevel.value;
    const shoal = shoalFactor(sea - terrain.heightAt(x, z), api.waves.breakDepth);
    api.waves.sample(x, z, t, shoal, out);
    out.height += sea;
    return out;
  }

  let lastTime = 0;
  function update(camera, weather, env, flash, dt) {
    const c = weather.current;
    const waves = api.waves;
    const gust = Math.min(weather.gustWind, 1.2);
    const severity = weather.key === 'storm' ? weather.severity : 0;
    waves.update(weather.windSpeed, Math.min(1, 0.25 + 0.65 * gust), dt, camera.position, severity);
    uniforms.uWave.value = waves.hs; // kelp sways harder in rough seas

    const [ga, gb] = waves.groups;
    u.uEnvA.value.set(ga.kx, ga.kz, ga.omega, ga.phase);
    u.uEnvB.value.set(gb.kx, gb.kz, gb.omega, gb.phase);
    u.uGroupStrength.value = waves.groupStrength;
    const r = waves.rogue;
    u.uRogue.value.set(r.x, r.z, r.strength, 0);
    u.uRogueDir.value.set(r.dx, r.dz);
    u.uGustiness.value = weather.gustiness;

    // Ripples drift with the wind in real time (also while paused). The
    // offset wraps at 2500 m, where every ripple layer lines up again.
    const now = uniforms.uTime.value;
    const rdt = Math.min(0.05, Math.max(0, now - lastTime));
    lastTime = now;
    const drift = u.uDrift.value;
    drift.addScaledVector(uniforms.uWindDir.value, rdt * (0.6 + 1.4 * gust));
    drift.set(drift.x % 2500, drift.y % 2500);
    api.mesh.position.set(camera.position.x, 0, camera.position.z);
    u.uBreakDepth.value = waves.breakDepth;
    u.uCamPos.value.copy(camera.position);
    u.uSunColor.value.copy(env.lightColor);
    u.uSunVis.value = env.lightVis;
    u.uDeep.value.copy(weather.waterColor).multiplyScalar(0.45);
    // Clear turquoise shallows in fair weather; stirred-up and murky in storms.
    u.uShallow.value.copy(weather.waterColor).lerp(SHALLOW_TINT, 0.5 * (1 - 0.7 * c.cloud * c.wind));
    u.uLight.value = 0.1 + 0.9 * env.dayF * (1 - 0.45 * c.cloud) + flash * 0.5;
    u.uFlash.value = flash;
    u.uChop.value = 0.08 + 0.4 * gust;
    u.uFoam.value = smoothstep(0.3, 0.8, gust);
    u.uAmpTotal.value = waves.total;
  }

  setQuality(qualityName);
  return api;
}
