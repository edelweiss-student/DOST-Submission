import * as THREE from 'three';
import { spearGeometry, SPEAR_TIP } from '../items/models.js';
import { patchMaterial } from './materials.js';
import { raySegment } from './timber.js';

const GRAVITY = 9.8;
const MAX = 32;          // spears in the world at once (the oldest go first)
const STEP = 0.25;       // longest stretch of a flight checked at once (m)
const DEPTH = 0.22;      // how far a point sinks into what it strikes (m)
const SHOWN = 8;         // seconds someone else's spear stays where it struck
const REACH = 3.2;       // to pick one up, from your eyes (m)
const STUMP = 0.5;       // a felled tree's stump (m)
const SHAFT = 1.6;       // the spear's length (items/models.js)
const UP = new THREE.Vector3(0, 1, 0);

// Thrown spears (the spear item: hold right-click, let go). Each flies from
// your hand under gravity, point first, checked a short stretch at a time:
// in a match through another team's player (strike), else into whatever it
// meets first, something built, a tree, a fallen trunk, a boulder or the
// ground, where it stays stuck, slanting, until you pick it up (E); or the
// sea, where it floats off as an item (gathering.js). Someone else's (a
// match) flies only to be seen: it sticks for a few seconds and goes.
// A spear: { tip, vel, dir, stack (yours, with its wear) or null, flying,
// left (seconds it stays, once stuck) }.
//
// colliders: trunks, fallen trunks and boulders (world/vegetation.js).
// strike(ray, length): in a match, the other team's player a stretch of a
// flight passes through, already reported, as how far along it, or null.
// dropItem(stack, position, velocity): an item into the world (gathering.js).
// onSound(name, strength); onBroken(): your spear wore out where it struck.
export function createSpears(scene, { terrain, water, colliders, building, inventory, dropItem, strike, onSound, onBroken }) {
  const spears = [];
  const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'world-item', snowMin: 0.6 });
  const mesh = new THREE.InstancedMesh(spearGeometry(), material, MAX);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const ray = new THREE.Ray(), a = new THREE.Vector3(), b = new THREE.Vector3(), surf = {}, found = [], near = {};
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();

  function add(spear) {
    // Make room: the oldest someone else threw, else the oldest of yours.
    if (spears.length >= MAX) spears.splice(Math.max(0, spears.findIndex((s) => !s.stack)), 1);
    spears.push(spear);
  }
  function remove(s) {
    const i = spears.indexOf(s);
    if (i >= 0) spears.splice(i, 1);
  }

  // How high a collider stands above the ground: a tree (or its stump, once
  // felled), a fallen trunk, a boulder.
  const standsTo = (c) => (c.tree ? (c.tree.felled ? STUMP : c.tree.height ?? 8) : c.height ?? 1);

  // What the point meets first, flying `len` metres from `from` along dir:
  // { d (how far), player }, or null.
  function meets(s, from, len) {
    ray.set(from, s.dir);
    let best = null;
    const d = s.stack && strike ? strike(ray, len) : null;
    if (d !== null && d <= len) best = { d, player: true };
    const piece = building.aimed(ray, len);
    if (piece && (!best || piece.distance < best.d)) best = { d: piece.distance };
    if (best) return best;
    b.copy(from).addScaledVector(s.dir, len);
    for (const c of colliders.query(b.x, b.z, found)) {
      const ground = terrain.heightAt(c.x, c.z);
      if ((b.x - c.x) ** 2 + (b.z - c.z) ** 2 < c.r * c.r && b.y > ground - 0.3 && b.y < ground + standsTo(c)) return { d: len };
    }
    // The ground: where along the stretch it goes under (by halving).
    if (b.y > terrain.heightAt(b.x, b.z)) return null;
    let lo = 0, hi = len;
    for (let k = 0; k < 6; k++) {
      const mid = (lo + hi) / 2;
      at.copy(from).addScaledVector(s.dir, mid);
      if (at.y > terrain.heightAt(at.x, at.z)) lo = mid;
      else hi = mid;
    }
    return { d: hi };
  }

  // Stuck where it struck, its point sunk in. Yours stays until you pick it
  // up, unless that was its last throw.
  function stick(s, where) {
    s.tip.copy(where).addScaledVector(s.dir, DEPTH);
    s.flying = false;
    s.left = s.stack ? Infinity : SHOWN;
    onSound?.('knock', 0.5);
    if (s.stack && s.stack.durability <= 0) {
      remove(s);
      onBroken?.();
    }
  }

  // A stretch of flight, `h` seconds: false once it has stopped.
  function fly(s, h, t) {
    s.vel.y -= GRAVITY * h;
    s.dir.copy(s.vel).normalize();
    const len = s.vel.length() * h;
    a.copy(s.tip);
    const hit = meets(s, a, len);
    if (hit?.player) {
      // It drops from the one it hit, to be picked up again.
      remove(s);
      if (s.stack.durability > 0) dropItem(s.stack, a.addScaledVector(s.dir, hit.d), new THREE.Vector3(0, 1, 0));
      else onBroken?.();
      return false;
    }
    if (hit) {
      stick(s, a.addScaledVector(s.dir, hit.d));
      return false;
    }
    s.tip.addScaledVector(s.dir, len);
    // Into the sea: it floats off (yours, as an item to swim after).
    const sea = water.surface(s.tip.x, s.tip.z, t, surf).height;
    if (s.tip.y < sea) {
      remove(s);
      onSound?.('splash', 0.4);
      if (s.stack && s.stack.durability > 0) dropItem(s.stack, at.set(s.tip.x, sea, s.tip.z), s.vel.clone().multiplyScalar(0.1));
      return false;
    }
    return true;
  }

  function render() {
    spears.forEach((s, i) => {
      // The geometry's grip is at its origin, its point SPEAR_TIP up +Y.
      q.setFromUnitVectors(UP, s.dir);
      mesh.setMatrixAt(i, m.compose(at.copy(s.tip).addScaledVector(s.dir, -SPEAR_TIP), q, one));
    });
    mesh.count = spears.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  // Picked up (E): back in the bag, with its wear.
  function pickUp(s) {
    if (inventory.addStack(s.stack) > 0) return { got: [], full: true };
    remove(s);
    return { got: [{ id: 'spear', count: 1 }] };
  }

  return {
    // Your throw: the spear (its stack, already worn by the throw) leaves
    // from `tip` (just ahead of your eye, `eye`) at `vel`. Something within
    // arm's reach catches it at once.
    throw(eye, tip, vel, stack) {
      const s = { tip: tip.clone(), vel: vel.clone(), dir: vel.clone().normalize(), stack, flying: true, left: Infinity };
      add(s);
      const reach = tip.distanceTo(eye);
      ray.set(eye, b.copy(tip).sub(eye).normalize());
      const piece = building.aimed(ray, reach);
      if (piece) stick(s, ray.at(piece.distance, a));
    },

    // Someone else's throw, in a match: just to be seen.
    ghost(from, vel) {
      add({ tip: from.clone(), vel: vel.clone(), dir: vel.clone().normalize(), stack: null, flying: true, left: Infinity });
    },

    update(dt, t) {
      for (const s of [...spears]) {
        if (!s.flying) {
          if ((s.left -= dt) <= 0) remove(s);
          continue;
        }
        // Short stretches, so it can't pass through a trunk between frames.
        let left = dt;
        while (left > 1e-4 && spears.includes(s) && s.flying) {
          const h = Math.min(left, STEP / Math.max(1, s.vel.length()));
          left -= h;
          if (!fly(s, h, t)) break;
        }
      }
      render();
    },

    // A spear of yours stuck under the crosshair, within reach: E picks it
    // up. As { score, key, prompt, act }, like gathering's.
    focus(aim) {
      let best = null;
      for (const s of spears) {
        if (s.flying || !s.stack) continue;
        if (s.tip.distanceToSquared(aim.origin) > (REACH + SHAFT) ** 2) continue;
        // The shaft, from its point back along it.
        at.copy(s.tip).addScaledVector(s.dir, -SHAFT / 2);
        raySegment(aim.origin, aim.direction, at, s.dir, SHAFT / 2, near);
        if (near.t > REACH || near.dist > 0.25) continue;
        const score = 3 - near.t * 0.3;
        if (!best || score > best.score) best = { score, key: s, prompt: [['E', 'Pick up spear']], act: () => pickUp(s) };
      }
      return best;
    },

    get count() { return spears.length; },
    // Where each lies (for testing): { tip, flying }.
    get list() { return spears.map(({ tip, flying, stack }) => ({ tip, flying, yours: !!stack })); },
  };
}
