import * as THREE from 'three';
import { isTool, toolGeometry } from '../items/models.js';
import { patchMaterial } from '../world/materials.js';
import { LOG_LENGTH, LOG_RADIUS, PLANK, logGeometry, boardGeometry } from '../world/wood.js';
import { CARRY } from '../world/timber.js';

// What's in your hands, at the lower right of the view: the selected tool,
// which bobs as you walk and swings when you use it, or the wood you're
// carrying instead (logs on your shoulder, planks under your arm).
// wood: the wood materials (world/wood.js), shared with the logs and
// planks lying in the world.
export function createHeldItem(scene, camera, wood) {
  scene.add(camera);   // things attached to the camera are only drawn if it's in the scene
  const hand = new THREE.Group();
  hand.scale.setScalar(0.85);
  camera.add(hand);
  const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'held-item', snowMin: 0.95 });
  const models = {};
  let shown = null;
  let swing = 0, bob = 0;

  // Carried wood: instanced like the wood in the world, so it shares its shaders.
  const arms = new THREE.Group();
  camera.add(arms);
  const logGeo = logGeometry(), boardGeo = boardGeometry();
  const logs = {};
  const logMesh = (bark) => {
    if (!logs[bark]) {
      logs[bark] = new THREE.InstancedMesh(logGeo, [wood.bark[bark], wood.endGrain, wood.endGrain], CARRY.log);
      logs[bark].instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CARRY.log * 3).fill(1), 3);
      logs[bark].count = 0;
      logs[bark].frustumCulled = false;
      arms.add(logs[bark]);
    }
    return logs[bark];
  };
  const planks = new THREE.InstancedMesh(boardGeo, wood.plank, CARRY.plank);
  planks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CARRY.plank * 3).fill(1), 3);
  planks.count = 0;
  planks.frustumCulled = false;
  arms.add(planks);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX'), p = new THREE.Vector3(), s = new THREE.Vector3();
  let carriedKey = '';

  // Logs lie on your right shoulder pointing ahead; planks are stacked under your arm.
  function showCarried(carried) {
    const key = carried.map((c) => c.kind + (c.bark ?? '')).join();
    if (key === carriedKey) return;
    carriedKey = key;
    for (const mesh of Object.values(logs)) mesh.count = 0;
    planks.count = 0;
    carried.forEach((c, i) => {
      if (c.kind === 'log') {
        const r = LOG_RADIUS[c.bark] * 0.75;
        const mesh = logMesh(c.bark);
        e.set(0, Math.PI / 2 + 0.05 - i * 0.03, -0.05);
        mesh.setMatrixAt(mesh.count++, m.compose(p.set(0.52 + i * 0.26, -0.4 + i * 0.05, -0.2), q.setFromEuler(e), s.set(LOG_LENGTH, r, r)));
        mesh.instanceMatrix.needsUpdate = true;
      } else {
        e.set(0, Math.PI / 2 + 0.1, -0.04);
        planks.setMatrixAt(planks.count++, m.compose(p.set(0.4, -0.45 - i * (PLANK.thick + 0.005), -0.35), q.setFromEuler(e), s.set(PLANK.length, PLANK.thick, PLANK.width)));
        planks.instanceMatrix.needsUpdate = true;
      }
    });
  }

  return {
    swing() { swing = 1; },

    // stack: the selected hotbar stack; speed: how fast you're moving (m/s);
    // carried: the logs or planks in your arms ([{ kind, bark }]), which
    // take the place of the tool.
    update(dt, stack, speed, carried = []) {
      showCarried(carried);
      const id = !carried.length && stack && isTool(stack.id) ? stack.id : null;
      if (id !== shown) {
        if (shown) models[shown].visible = false;
        if (id) {
          models[id] ??= hand.add(new THREE.Mesh(toolGeometry(id), material)).children.at(-1);
          models[id].visible = true;
        }
        shown = id;
      }
      const moving = Math.min(1, speed / 4);
      bob += dt * (2 + speed * 1.4);
      arms.position.set(0, Math.sin(bob * 2) * 0.02 * moving, 0);
      if (!id) return;
      swing = Math.max(0, swing - dt * 3.5);
      const sw = Math.sin(swing * Math.PI);   // out and back over the swing
      hand.position.set(0.34 + sw * 0.04, -0.46 + Math.sin(bob * 2) * 0.012 * moving, -0.6 - sw * 0.08);
      hand.rotation.set(-0.45 - sw * 1.1, 0.35, 0.45 + Math.sin(bob) * 0.02 * moving);
    },
  };
}
