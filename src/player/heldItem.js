import * as THREE from 'three';
import { isTool, toolGeometry } from '../items/models.js';
import { patchMaterial } from '../world/materials.js';

// The selected tool in your right hand, at the lower right of the view. It
// bobs as you walk and swings when you use it.
export function createHeldItem(scene, camera) {
  scene.add(camera);   // things attached to the camera are only drawn if it's in the scene
  const hand = new THREE.Group();
  hand.scale.setScalar(0.85);
  camera.add(hand);
  const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'held-item', snowMin: 0.95 });
  const models = {};
  let shown = null;
  let swing = 0, bob = 0;

  return {
    swing() { swing = 1; },

    // stack: the selected hotbar stack; speed: how fast you're moving (m/s).
    update(dt, stack, speed) {
      const id = stack && isTool(stack.id) ? stack.id : null;
      if (id !== shown) {
        if (shown) models[shown].visible = false;
        if (id) {
          models[id] ??= hand.add(new THREE.Mesh(toolGeometry(id), material)).children.at(-1);
          models[id].visible = true;
        }
        shown = id;
      }
      if (!id) return;
      const moving = Math.min(1, speed / 4);
      bob += dt * (2 + speed * 1.4);
      swing = Math.max(0, swing - dt * 3.5);
      const s = Math.sin(swing * Math.PI);   // out and back over the swing
      hand.position.set(0.34 + s * 0.04, -0.46 + Math.sin(bob * 2) * 0.012 * moving, -0.6 - s * 0.08);
      hand.rotation.set(-0.45 - s * 1.1, 0.35, 0.45 + Math.sin(bob) * 0.02 * moving);
    },
  };
}
