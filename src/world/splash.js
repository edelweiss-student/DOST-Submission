import * as THREE from 'three';

const MAX = 192;

// Droplet bursts when something hits the water. A fixed ring buffer of
// points, simulated on the CPU only while a splash is alive.
export function createSplashes(scene) {
  const pos = new Float32Array(MAX * 3);
  const col = new Float32Array(MAX * 4);
  const vel = new Float32Array(MAX * 3);
  const life = new Float32Array(MAX);
  const span = new Float32Array(MAX);

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const colAttr = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colAttr);
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.16, vertexColors: true, transparent: true, depthWrite: false,
  }));
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  let next = 0;
  let alive = 0;

  function emit(x, y, z, strength) {
    const count = Math.min(MAX, Math.round(24 + strength * 10));
    for (let n = 0; n < count; n++) {
      const i = next;
      next = (next + 1) % MAX;
      const a = Math.random() * Math.PI * 2, r = Math.random();
      const out = (1 + strength * 0.4) * r;
      pos[i * 3] = x + Math.cos(a) * r * 0.6;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z + Math.sin(a) * r * 0.6;
      vel[i * 3] = Math.cos(a) * out;
      vel[i * 3 + 1] = (2.5 + Math.random() * 2.5) * (0.6 + strength * 0.12);
      vel[i * 3 + 2] = Math.sin(a) * out;
      span[i] = life[i] = 0.6 + Math.random() * 0.6;
    }
    alive = 2;
  }

  function update(dt, light) {
    if (alive <= 0) return;
    alive -= dt;
    const shade = 0.1 + 0.85 * light;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) { col[i * 4 + 3] = 0; continue; }
      life[i] -= dt;
      vel[i * 3 + 1] -= 9.8 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = shade;
      col[i * 4 + 3] = Math.max(0, life[i] / span[i]) * 0.9;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  return { emit, update };
}
