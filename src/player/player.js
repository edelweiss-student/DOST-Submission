import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { WORLD, uniforms, clamp, smoothstep } from '../shared.js';

const EYE = 1.7;
const BODY = 1.8;
const WALK = 5.5, SPRINT = 9.5, SWIM = 3.6, SWIM_FAST = 6.2;
const GRAVITY = 24, JUMP = 7.5;
const FLOAT_DEPTH = 1.45;       // feet below the surface while treading water
const STEP = 0.5;               // highest ledge you step up onto (a built floor)
const CLIMB = 2.2;              // ...or climb onto out of the water
const LADDER_SPEED = 2.4;       // m/s up or down a ladder
export const MAX_OXYGEN = 30;   // seconds of breath

// Stamina per second in mild weather: about 12 s of sprinting or 10 s of
// fast swimming from full. Standing still refills it in about 7 s. Run it
// dry and you can't sprint, and move slower, until it's back to RECOVERED.
export const MAX_STAMINA = 100;
const SPRINT_COST = 8, SWIM_FAST_COST = 10;
const REST = 14, REST_MOVING = 6;   // standing still, walking (half that while swimming)
const RECOVERED = 30;
const TIRED = 0.7;                  // speed while exhausted

// Heat: the heat index is a shade value. Full sun adds up to SUN_HEAT °C and
// shade blocks it (tree crowns, and a little from bushes). The sea cools
// you to SEA_TEMP. From 27 °C you
// tire faster and recover slower: sprinting drains stamina twice as fast at
// 41 °C (the "danger" level), about three times at 54 °C ("extreme danger")
// and four times from 69 °C, where you recover at a quarter of the rate.
const SUN_HEAT = 8, SEA_TEMP = 26;

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
    this.stamina = MAX_STAMINA;
    this.exhausted = false;
    this.heat = 20;        // how hot you feel, °C
    this.strain = 0;       // 0..1, how hard the heat is on you
    this.dragLook = false;
    this.inputEnabled = true;   // off while a menu (the inventory) has the keys
    this.burden = 0;            // 0 empty-handed .. 1 carrying all you can (logs)
    this.climbing = false;      // on a ladder
    // What you've built (world/building.js): floorAt, collide, ladderAt and shelterAt.
    this.structures = null;
    // keepOut(pos, vel): pushes you back out of anywhere you can't go (in a
    // multiplayer match, the other teams' bases while their barriers are up).
    this.keepOut = null;
    this.onMessage = null;
    this.onSplash = null;
    this.onBlackout = null;
    this.edgeWarned = 0;
    this.tiredWarned = -Infinity;
    addEventListener('keydown', (e) => { if (this.inputEnabled) this.keys.add(e.code); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.spawn = terrain.findSpawn();
    this.respawn();
  }

  // Fallback for browsers that refuse pointer lock: hold the left button and drag to look.
  enableDragLook(dom) {
    const euler = new THREE.Euler(0, 0, 0, 'YXZ');
    dom.addEventListener('mousemove', (e) => {
      if (!this.dragLook || !this.inputEnabled || !(e.buttons & 1)) return;
      euler.setFromQuaternion(this.camera.quaternion);
      euler.y -= e.movementX * 0.004;
      euler.x = Math.max(-1.5, Math.min(1.5, euler.x - e.movementY * 0.004));
      this.camera.quaternion.setFromEuler(euler);
    });
  }

  // Movement keys and drag-to-look on or off (a menu is open). Keys held
  // down are let go, so you don't keep walking behind the menu.
  setInput(enabled) {
    this.inputEnabled = enabled;
    this.keys.clear();
  }

  // Eating gives back stamina and health (see `eat` in items/items.js).
  eat({ stamina = 0, health = 0 }) {
    this.stamina = Math.min(MAX_STAMINA, this.stamina + stamina);
    this.health = Math.min(100, this.health + health);
    if (this.stamina >= RECOVERED) this.exhausted = false;
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
    this.stamina = MAX_STAMINA;
    this.exhausted = false;
  }

  // How high a ledge you can get up onto: a step on land, more out of the water.
  get ledge() { return this.swimming || this.inWater ? CLIMB : STEP; }

  // The ground under you: the terrain, or a floor you've built that you're
  // on or can get up onto.
  groundAt(x, z) {
    const g = this.terrain.heightAt(x, z);
    if (!this.structures) return g;
    return Math.max(g, this.structures.floorAt(x, z, this.pos.y + this.ledge));
  }

  // heatIndex: the weather's heat index, °C.
  update(dt, t, heatIndex = 20) {
    const k = this.keys, p = this.pos, v = this.vel;
    const ix = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const iz = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    // Too tired to sprint until you've got some stamina back, and no
    // sprinting under a heavy load.
    const sprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && !this.exhausted && this.burden < 0.5;

    this.camera.getWorldDirection(fwd);
    right.set(-fwd.z, 0, fwd.x).normalize();
    const ground = this.groundAt(p.x, p.z);
    const surf = this.water.surface(p.x, p.z, t, bodySample);
    const submerged = (surf.height - p.y) / BODY;
    // Hysteresis so bobbing on a wave doesn't flip between walking and swimming.
    this.swimming = surf.height - ground > FLOAT_DEPTH && submerged > (this.swimming ? 0.4 : 0.6);
    // A ladder: climb on at its foot with W or Space, or catch hold of it
    // stepping off its floor. Swimming, you climb on only if you mean to;
    // standing at its foot (or on the deck at its top), you let go.
    const ladder = this.structures?.ladderAt(p.x, p.y, p.z);
    const up = k.has('KeyW') || k.has('Space');
    const atTop = !!ladder && this.grounded && p.y > ladder.top - 0.3;
    this.climbing = !!ladder && ((up && !atTop) || (!this.grounded && (this.climbing || !this.swimming)));
    if (this.climbing) this.swimming = false;

    if (this.climbing) this.climb(dt, ix, ladder);
    else if (this.swimming) this.swim(dt, sprint, ix, iz, surf);
    else this.walk(dt, sprint, ix, iz, surf, submerged);

    const inWater = p.y < surf.height - 0.1;
    if (inWater && !this.inWater && v.y < -3) this.onSplash?.(p.x, surf.height, p.z, -v.y);
    this.inWater = inWater;

    this.collide(t);

    // Ground contact, with snapping so walking downhill doesn't bounce.
    const g = this.groundAt(p.x, p.z);
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
    this.warm(dt, heatIndex, g, submerged);
    const moving = ix !== 0 || iz !== 0 || (this.swimming && (k.has('Space') || k.has('KeyC')));
    this.tire(dt, t, sprint && moving, moving);
  }

  swim(dt, sprint, ix, iz, surf) {
    const k = this.keys, p = this.pos, v = this.vel;
    const speed = (sprint ? SWIM_FAST : SWIM) * (this.exhausted ? TIRED : 1) * (1 - 0.3 * this.burden);
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

  // On a ladder: W or Space climbs, S goes down, A and D shuffle sideways.
  // Near the top, climbing on while facing the deck takes you onto it.
  climb(dt, ix, ladder) {
    const k = this.keys, p = this.pos, v = this.vel;
    const up = k.has('KeyW') || k.has('Space'), down = k.has('KeyS');
    v.y = (up ? LADDER_SPEED : 0) - (down ? LADDER_SPEED : 0);
    const facing = -(fwd.x * ladder.nx + fwd.z * ladder.nz) / (Math.hypot(fwd.x, fwd.z) || 1);
    const onto = up && facing > 0.3 && p.y > ladder.top - 0.5 ? 1.6 : 0;
    v.x = -ladder.nx * onto + right.x * ix * 1.2;
    v.z = -ladder.nz * onto + right.z * ix * 1.2;
    p.addScaledVector(v, dt);
    p.y = Math.min(p.y, ladder.top + 0.1);
    this.grounded = false;
  }

  walk(dt, sprint, ix, iz, surf, submerged) {
    const p = this.pos, v = this.vel;
    const wading = submerged > 0.2;
    wish.set(fwd.x, 0, fwd.z).normalize().multiplyScalar(iz).addScaledVector(right, ix);
    // Carrying logs slows you down (a third slower with two).
    const load = 1 - 0.35 * this.burden;
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar((sprint ? SPRINT : WALK) * (wading ? 0.6 : 1) * (this.exhausted ? TIRED : 1) * load);
    const accel = Math.min(1, dt * (this.grounded ? 10 : 2));
    v.x += (wish.x - v.x) * accel;
    v.z += (wish.z - v.z) * accel;
    v.y -= GRAVITY * dt;
    if (this.grounded && this.keys.has('Space')) { v.y = JUMP * (1 - 0.2 * this.burden); this.grounded = false; }
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
    this.structures?.collide(p, 0.35, BODY, this.ledge);
    for (const c of this.colliders.query(p.x, p.z, near)) {
      const dx = p.x - c.x, dz = p.z - c.z, min = c.r + 0.35;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
    this.keepOut?.(p, this.vel);
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
      this.onBlackout?.();
      this.onMessage?.('You blacked out… and woke up on the shore.');
      this.respawn();
    }
  }

  // How hot you feel: the heat index, plus the sun unless plants or a roof
  // shade you, and cooled right down in the water. Your body takes a while
  // to warm up again, so you stay cool for a bit after a swim.
  warm(dt, heatIndex, ground, submerged) {
    const p = this.pos;
    // Plants the sea has killed have no leaves left to give shade.
    const plants = this.terrain.canopyAt(p.x, p.z) * (1 - smoothstep(0, 0.9, uniforms.uTreeKillLine.value - ground));
    const shade = Math.max(plants, this.structures?.shelterAt(p.x, p.y + EYE, p.z) ?? 0);
    let felt = heatIndex + SUN_HEAT * uniforms.uSunlight.value * (1 - shade);
    const wet = this.swimming ? 1 : clamp(submerged, 0, 1);
    felt += (Math.min(felt, SEA_TEMP) - felt) * wet;
    this.heat += (felt - this.heat) * (1 - Math.exp(-dt / (wet > 0.3 ? 4 : 15)));
    this.strain = clamp((this.heat - 27) / 42, 0, 1);
  }

  // True once the heat is clearly wearing you down (from about 35 °C).
  get hot() { return this.strain > 0.2; }

  // Sprinting and fast swimming wear you out; resting brings you back,
  // standing still fastest. Heat makes you tire faster and recover slower.
  tire(dt, t, sprinting, moving) {
    const s = this.strain;
    if (sprinting) this.stamina -= (this.swimming ? SWIM_FAST_COST : SPRINT_COST) * (1 + 3 * s) * dt;
    else this.stamina += (moving ? REST_MOVING : REST) * (this.swimming ? 0.5 : 1) * (1 - 0.75 * s) * dt;
    this.stamina = clamp(this.stamina, 0, MAX_STAMINA);
    if (this.exhausted) {
      this.exhausted = this.stamina < RECOVERED;
    } else if (this.stamina <= 0) {
      this.exhausted = true;
      if (t - this.tiredWarned > 30) {
        this.tiredWarned = t;
        this.onMessage?.(this.hot
          ? 'The heat has worn you out. Cool off in the sea or find some shade.'
          : 'You’re out of breath. Slow down for a moment.');
      }
    }
  }
}
