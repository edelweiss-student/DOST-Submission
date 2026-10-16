import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { WORLD, uniforms, clamp } from '../shared.js';

const EYE = 1.7;
const BODY = 1.8;
const WALK = 5.5, SPRINT = 9.5, SWIM = 3.6, SWIM_FAST = 6.2;
const GRAVITY = 24, JUMP = 7.5;
const FLOAT_DEPTH = 1.45;       // feet below the surface while treading water
export const MAX_OXYGEN = 30;   // seconds of breath

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), wish = new THREE.Vector3();
const near = [];
const bodySample = {}, headSample = {};

export class Player {
  constructor(camera, dom, terrain, colliders, water) {
    this.camera = camera;
    this.terrain = terrain;
    this.colliders = colliders;
    this.water = water;
    this.controls = new PointerLockControls(camera, dom);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.grounded = false;
    this.swimming = false;
    this.inWater = false;
    this.underwater = false;
    this.depth = 0;
    this.roll = 0;
    this.oxygen = MAX_OXYGEN;
    this.health = 100;
    this.dragLook = false;
    this.onMessage = null;
    this.onSplash = null;
    this.edgeWarned = 0;
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.spawn = terrain.findSpawn();
    this.respawn();
  }

  // Fallback for browsers that refuse pointer lock: hold the left button and drag to look.
  enableDragLook(dom) {
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    dom.addEventListener('mousemove', (e) => {
      if (!this.dragLook || !(e.buttons & 1)) return;
      euler.setFromQuaternion(this.camera.quaternion);
      euler.y -= e.movementX * 0.004;
      euler.x = Math.max(-1.5, Math.min(1.5, euler.x - e.movementY * 0.004));
      this.camera.quaternion.setFromEuler(euler);
    });
  }

  respawn() {
    // If the rising sea swallowed the old beach, walk inland until dry.
    let { x, z } = this.spawn;
    const sea = uniforms.uWaterLevel.value;
    for (let i = 0; i < 60 && this.terrain.heightAt(x, z) < sea + 1.2; i++) { x *= 0.97; z *= 0.97; }
    this.pos.set(x, this.terrain.heightAt(x, z) + 0.05, z);
    this.vel.set(0, 0, 0);
    this.roll = 0;
    this.camera.rotation.set(0, this.spawn.yaw, 0, 'YXZ');
    this.oxygen = MAX_OXYGEN;
    this.health = 100;
  }

  update(dt, t) {
    const k = this.keys, p = this.pos, v = this.vel;
    const ix = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const iz = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');

    this.camera.getWorldDirection(fwd);
    right.set(-fwd.z, 0, fwd.x).normalize();
    const ground = this.terrain.heightAt(p.x, p.z);
    const surf = this.water.surface(p.x, p.z, t, bodySample);
    const submerged = (surf.height - p.y) / BODY;
    // Hysteresis so bobbing on a wave doesn't flip between walking and swimming.
    this.swimming = surf.height - ground > FLOAT_DEPTH && submerged > (this.swimming ? 0.4 : 0.6);

    if (this.swimming) this.swim(dt, sprint, ix, iz, surf);
    else this.walk(dt, sprint, ix, iz, surf, submerged);

    const inWater = p.y < surf.height - 0.1;
    if (inWater && !this.inWater && v.y < -3) this.onSplash?.(p.x, surf.height, p.z, -v.y);
    this.inWater = inWater;

    this.collide(t);

    // Ground contact, with snapping so walking downhill doesn't bounce.
    const g = this.terrain.heightAt(p.x, p.z);
    if (p.y <= g || (this.grounded && !this.swimming && v.y <= 0 && p.y - g < 0.6)) {
      p.y = g;
      v.y = Math.max(v.y, 0);
      this.grounded = !this.swimming;
    } else if (!this.swimming) {
      this.grounded = false;
    }

    // Floating on a wave tilts your view with the water.
    const atSurface = this.swimming && p.y > surf.height - FLOAT_DEPTH - 1;
    const tilt = atSurface ? (surf.slopeX * right.x + surf.slopeZ * right.z) * 0.6 : 0;
    this.roll += (clamp(tilt, -0.15, 0.15) - this.roll) * Math.min(1, dt * 3);
    this.camera.rotation.z = this.roll;

    this.camera.position.set(p.x, p.y + EYE, p.z);
    const sea = this.water.surface(p.x, p.z, t, headSample).height;
    this.underwater = this.camera.position.y < sea - 0.05;
    this.depth = Math.max(0, sea - this.camera.position.y);
    this.breathe(dt);
  }

  swim(dt, sprint, ix, iz, surf) {
    const k = this.keys, p = this.pos, v = this.vel;
    const speed = sprint ? SWIM_FAST : SWIM;
    wish.copy(fwd).multiplyScalar(iz).addScaledVector(right, ix);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    const up = k.has('Space'), down = k.has('KeyC');
    if (up) wish.y = speed * 0.8;
    if (down) wish.y = -speed * 0.8;

    // Currents: the waves' orbital motion (fading with depth) plus wind drift.
    const below = Math.max(0, surf.height - (p.y + 1));
    const decay = Math.exp(-below * 0.25);
    const wind = uniforms.uWind.value, wd = uniforms.uWindDir.value;
    const cx = (surf.vx * 0.8 + wd.x * wind * 1.4) * decay;
    const cz = (surf.vz * 0.8 + wd.y * wind * 1.4) * decay;
    const drag = Math.min(1, dt * 2.5);
    v.x += (wish.x + cx - v.x) * drag;
    v.z += (wish.z + cz - v.z) * drag;

    const floatY = surf.height - FLOAT_DEPTH;
    const diving = down || wish.y < -0.25 * speed;
    if (!diving && p.y > floatY - 2.5) {
      // Buoyancy: a damped spring toward floating depth, so you ride the waves.
      // Stiff and well damped (~4 rad/s, damping ratio ~0.9) so the body
      // follows the swell without amplifying it.
      const target = floatY + (up ? 0.3 : 0);
      v.y += ((target - p.y) * 16 + (surf.vy - v.y) * 7) * dt;
    } else if (diving || wish.y > 0) {
      v.y += (wish.y - v.y) * drag;
    } else {
      v.y += (0.8 - v.y) * Math.min(1, dt * 0.8); // drift up from the depths
    }
    p.addScaledVector(v, dt);
    if (p.y > floatY + 0.4) {
      p.y = floatY + 0.4;
      v.y = Math.min(v.y, surf.vy);
    }
    this.grounded = false;
  }

  walk(dt, sprint, ix, iz, surf, submerged) {
    const p = this.pos, v = this.vel;
    const wading = submerged > 0.2;
    wish.set(fwd.x, 0, fwd.z).normalize().multiplyScalar(iz).addScaledVector(right, ix);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar((sprint ? SPRINT : WALK) * (wading ? 0.6 : 1));
    const accel = Math.min(1, dt * (this.grounded ? 10 : 2));
    v.x += (wish.x - v.x) * accel;
    v.z += (wish.z - v.z) * accel;
    v.y -= GRAVITY * dt;
    if (this.grounded && this.keys.has('Space')) { v.y = JUMP; this.grounded = false; }
    p.addScaledVector(v, dt);
    // The surf pushes and pulls at you while wading.
    if (wading) {
      const push = Math.min(1, submerged) * 0.6;
      p.x += surf.vx * push * dt;
      p.z += surf.vz * push * dt;
    }
  }

  collide(t) {
    const p = this.pos;
    for (const c of this.colliders.query(p.x, p.z, near)) {
      const dx = p.x - c.x, dz = p.z - c.z, min = c.r + 0.35;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
    const r = Math.hypot(p.x, p.z);
    if (r > WORLD.maxRadius) {
      p.x *= WORLD.maxRadius / r;
      p.z *= WORLD.maxRadius / r;
      if (t - this.edgeWarned > 6) {
        this.edgeWarned = t;
        this.onMessage?.('The currents are too strong to swim any further.');
      }
    }
  }

  breathe(dt) {
    if (this.underwater) this.oxygen = Math.max(0, this.oxygen - dt);
    else this.oxygen = Math.min(MAX_OXYGEN, this.oxygen + dt * 6);
    if (this.oxygen <= 0) this.health -= 12 * dt;
    else this.health = Math.min(100, this.health + 2 * dt);
    if (this.health <= 0) {
      this.onMessage?.('You blacked out… and woke up on the shore.');
      this.respawn();
    }
  }
}
