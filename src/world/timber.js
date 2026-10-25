import * as THREE from 'three';
import { uniforms } from '../shared.js';
import { SPECIES } from './trees.js';
import { LOG_LENGTH, LOG_RADIUS, PLANK, PLANKS_PER_LOG, logGeometry, boardGeometry } from './wood.js';

// Timber: felling trees, and the logs and planks lying in the world. Wood
// never goes in the bag: you carry it in your arms (a couple of logs or a
// stack of planks), split logs into planks with the axe where they lie,
// and build with the planks (see building.js). Logs and planks float, and
// drift with the waves and the wind.

const MAX_LOGS = 120;            // in the world; the oldest go past this
const MAX_PLANKS = 400;
const SPLIT_CHOPS = 2;           // axe hits to split a log into planks
export const CARRY = { log: 2, plank: 8 };   // most you can carry at once
// Axe hits to fell a tree of average size; bigger trees take more.
const CHOPS = { mate: 3, birch: 4, eucalyptus: 6, oak: 8 };
// How much of a tree's height is clear trunk, cut into logs when it falls.
const TRUNK = { mate: 0.45, birch: 0.45, eucalyptus: 0.42, oak: 0.34 };
const STUMP = 0.45;              // stump height above the ground (m)
const REACH = 3.2;               // from your eyes (m)
const NAMES = { log: ['log', 'logs'], plank: ['plank', 'planks'] };
export const woodName = (kind, n = 1) => NAMES[kind][n === 1 ? 0 : 1];

const length = (p) => (p.kind === 'log' ? LOG_LENGTH : PLANK.length);
// Half the piece's height lying down, and its reach radius for aiming.
const halfHeight = (p) => (p.kind === 'log' ? LOG_RADIUS[p.bark] : PLANK.thick / 2);
const aimRadius = (p) => (p.kind === 'log' ? LOG_RADIUS[p.bark] : PLANK.width / 2);

// Closest approach between a ray (origin o, unit direction u) and a segment
// (centre c, unit axis a, half-length h): out.dist between them, out.t along the ray.
export function raySegment(o, u, c, a, h, out) {
  const wx = o.x - c.x, wy = o.y - c.y, wz = o.z - c.z;
  const b = u.x * a.x + u.y * a.y + u.z * a.z;
  const d = u.x * wx + u.y * wy + u.z * wz;
  const e = a.x * wx + a.y * wy + a.z * wz;
  const den = 1 - b * b;
  let s = den > 1e-6 ? (e - b * d) / den : e;
  s = Math.max(-h, Math.min(h, s));
  const t = Math.max(0, s * b - d);
  out.t = t;
  out.dist = Math.hypot(o.x + u.x * t - c.x - a.x * s, o.y + u.y * t - c.y - a.y * s, o.z + u.z * t - c.z - a.z * s);
  return out;
}

// groundAt(x, z, y): the terrain, or a floor built there below y.
// dropItem(stack, position, velocity): puts an item in the world (sticks from a crown).
// onSound(name, strength): chops, cracks and thuds.
// onImpact({ kind: 'fell', tree }): a tree came down (for the climate, climate/entity.js).
export function createTimber(scene, { terrain, water, forest, trees, wood, groundAt, dropItem, onSound, onImpact, rng, shadows }) {
  const pieces = [];      // logs and planks lying in the world (or floating)
  const carried = [];     // in your arms, last picked up last
  const stumps = [];
  const chopping = new Map();   // standing trees being chopped: tree -> { handle, shake, dx, dz }
  const falling = [];
  let changed = true;

  // --- Drawing: one instanced mesh per bark for logs and stumps, one for planks.
  const logGeo = logGeometry(), boardGeo = boardGeometry();
  const logMeshes = {};
  for (const [bark, material] of Object.entries(wood.bark)) {
    const capacity = MAX_LOGS + trees.filter((t) => t.species === bark).length;
    const mesh = new THREE.InstancedMesh(logGeo, [material, wood.endGrain, wood.endGrain], capacity);
    // Untinted, but coloured like the built pilings' logs (building.js), so they share a shader.
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    logMeshes[bark] = mesh;
  }
  const plankMesh = new THREE.InstancedMesh(boardGeo, wood.plank, MAX_PLANKS);
  plankMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PLANKS * 3), 3);
  plankMesh.count = 0;
  plankMesh.frustumCulled = false;
  plankMesh.castShadow = shadows;
  plankMesh.receiveShadow = true;
  scene.add(plankMesh);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX'), sc = new THREE.Vector3();
  const tint = new THREE.Color();
  // A piece lies along its own +X axis: turned by yaw, tilted by pitch.
  function pieceMatrix(p) {
    e.set(0, p.yaw, p.pitch);
    if (p.kind === 'log') sc.set(LOG_LENGTH, LOG_RADIUS[p.bark], LOG_RADIUS[p.bark]);
    else sc.set(PLANK.length, PLANK.thick, PLANK.width);
    return m.compose(p.pos, q.setFromEuler(e), sc);
  }
  const plankTint = (p) => tint.setRGB(0.88 + p.tone * 0.22, 0.86 + p.tone * 0.2, 0.84 + p.tone * 0.18);

  function render() {
    const n = {};
    for (const bark in logMeshes) n[bark] = 0;
    for (const s of stumps) logMeshes[s.bark].setMatrixAt(n[s.bark]++, s.matrix);
    let planks = 0;
    for (const p of pieces) {
      if (p.kind === 'log') {
        logMeshes[p.bark].setMatrixAt(n[p.bark]++, pieceMatrix(p));
      } else {
        plankMesh.setMatrixAt(planks, pieceMatrix(p));
        plankMesh.setColorAt(planks++, plankTint(p));
      }
    }
    for (const bark in logMeshes) {
      logMeshes[bark].count = n[bark];
      logMeshes[bark].instanceMatrix.needsUpdate = true;
    }
    plankMesh.count = planks;
    plankMesh.instanceMatrix.needsUpdate = true;
    plankMesh.instanceColor.needsUpdate = true;
  }

  // --- Pieces in the world.
  function add(p) {
    const max = p.kind === 'log' ? MAX_LOGS : MAX_PLANKS;
    if (pieces.filter((o) => o.kind === p.kind).length >= max) pieces.splice(pieces.findIndex((o) => o.kind === p.kind), 1);
    p.asleep = false;
    pieces.push(p);
    changed = true;
  }
  function spawn(kind, bark, x, y, z, yaw, vx = 0, vy = 0, vz = 0, spin = 0) {
    add({
      kind, bark, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(vx, vy, vz),
      yaw, pitch: 0, spin, drift: rng() < 0.5 ? -1 : 1, tone: rng(), chops: 0, check: 0,
    });
  }
  function removePiece(p) {
    const i = pieces.indexOf(p);
    if (i >= 0) pieces.splice(i, 1);
    changed = true;
  }

  // Falls, comes to rest along the ground (or a floor), or floats.
  const surf = {};
  function simulate(p, dt, t) {
    // Lying still: only check now and then whether the water has come up to it.
    if (p.asleep && t < p.check) return false;
    const len = length(p), half = halfHeight(p);
    const ax = Math.cos(p.yaw) * len * 0.45, az = -Math.sin(p.yaw) * len * 0.45;
    const ga = groundAt(p.pos.x - ax, p.pos.z - az, p.pos.y), gb = groundAt(p.pos.x + ax, p.pos.z + az, p.pos.y);
    const rest = Math.max((ga + gb) / 2, groundAt(p.pos.x, p.pos.z, p.pos.y)) + half;
    water.surface(p.pos.x, p.pos.z, t, surf);
    const floatY = surf.height - half * 0.25;
    if (p.asleep) {
      if (floatY <= rest) {
        p.check = t + 1;
        return false;
      }
      p.asleep = false;
    }
    const wind = uniforms.uWind.value, wd = uniforms.uWindDir.value;
    const floating = floatY > rest && p.pos.y < surf.height + 0.3;
    if (floating) {
      // Riding the waves, pushed by them and the wind, turning slowly.
      p.pos.y += (floatY - p.pos.y) * Math.min(1, dt * 4);
      const along = surf.slopeX * Math.cos(p.yaw) - surf.slopeZ * Math.sin(p.yaw);
      p.pitch += (Math.atan(along) - p.pitch) * Math.min(1, dt * 4);
      const push = p.kind === 'log' ? 0.3 : 0.45;
      p.vel.set(surf.vx * 0.6 + wd.x * wind * push, 0, surf.vz * 0.6 + wd.y * wind * push);
      p.spin = p.drift * 0.12 * wind;
    } else {
      p.vel.y -= 9.8 * dt;
      if (p.pos.y < surf.height) p.vel.multiplyScalar(Math.exp(-3 * dt));   // sinking through the water
    }
    p.pos.addScaledVector(p.vel, dt);
    p.yaw += p.spin * dt;
    if (!floating && p.pos.y <= rest) {
      if (p.vel.y < -3) onSound?.(p.kind === 'log' ? 'log' : 'plank', Math.min(1, -p.vel.y / 8));
      p.pos.y = rest;
      p.vel.set(0, 0, 0);
      p.spin = 0;
      p.pitch = Math.atan2(gb - ga, len * 0.9);
      p.asleep = true;
      p.check = t + 1;
    }
    return true;
  }

  // --- Felling.
  const chopsNeeded = (tree) => Math.max(2, Math.round(CHOPS[tree.species] * tree.s));
  const R = new THREE.Matrix4(), T = new THREE.Matrix4(), M = new THREE.Matrix4(), axis = new THREE.Vector3();
  // A tree turned by `angle` about its base, towards (dx, dz).
  function lean(handle, pivot, dx, dz, angle) {
    R.makeRotationAxis(axis.set(dz, 0, -dx), angle);
    M.copy(handle.placed)
      .premultiply(T.makeTranslation(-pivot.x, -pivot.y, -pivot.z))
      .premultiply(R)
      .premultiply(T.makeTranslation(pivot.x, pivot.y, pivot.z));
    handle.set(M);
  }

  function addStump(tree) {
    const r = SPECIES[tree.species].trunk * tree.s;
    const ground = terrain.heightAt(tree.x, tree.z);
    const bottom = ground - 0.3, top = ground + STUMP;
    // The log shape stood on end.
    e.set(0, tree.rot, Math.PI / 2);
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(tree.x, (bottom + top) / 2, tree.z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(top - bottom, r, r));
    stumps.push({ bark: tree.species, matrix });
    changed = true;
  }

  // An axe blow on a standing tree, from where you stand. Returns true when
  // it's the last one and the tree comes down.
  function chop(tree, from) {
    let c = chopping.get(tree);
    if (!c) chopping.set(tree, (c = { handle: forest.detach(tree), shake: 0, dx: 1, dz: 0 }));
    tree.chops = (tree.chops ?? 0) + 1;
    const dx = tree.x - from.x, dz = tree.z - from.z, d = Math.hypot(dx, dz) || 1;
    c.dx = dx / d;
    c.dz = dz / d;
    c.shake = 1;
    onSound?.('chop', 1);
    if (tree.chops < chopsNeeded(tree)) return false;

    // Timber! It falls away from you, a little to one side or the other.
    chopping.delete(tree);
    tree.felled = true;
    onImpact?.({ kind: 'fell', tree });
    const turn = (rng() - 0.5) * 0.6, cos = Math.cos(turn), sin = Math.sin(turn);
    const sp = SPECIES[tree.species];
    terrain.addCanopy(tree.x, tree.z, sp.crown * tree.s, -sp.shade);
    terrain.commitCanopy();
    addStump(tree);
    falling.push({
      tree, handle: c.handle, dx: c.dx * cos - c.dz * sin, dz: c.dx * sin + c.dz * cos,
      pivot: new THREE.Vector3(tree.x, terrain.heightAt(tree.x, tree.z) + STUMP, tree.z),
      angle: 0.03, speed: 0.15, down: 0, landed: false,
    });
    onSound?.('crack', 1);
    return true;
  }

  // Has the falling trunk (or the crown at its end) reached the ground?
  function touchesGround(f) {
    const s = Math.sin(f.angle), c = Math.cos(f.angle);
    for (const along of [0.3, 0.55, 0.8, 1]) {
      const h = f.tree.height * along;
      const x = f.pivot.x + f.dx * s * h, z = f.pivot.z + f.dz * s * h;
      if (f.pivot.y + c * h < terrain.heightAt(x, z) + 0.35 * (1 - along * 0.5)) return true;
    }
    return false;
  }

  // Once it has come to rest: the trunk becomes logs, the crown leaves sticks.
  function breakUp(f) {
    const { tree } = f;
    f.handle.remove();
    const s = Math.sin(f.angle), c = Math.cos(f.angle);
    const dir = new THREE.Vector3(f.dx * s, c, f.dz * s);
    const yaw = Math.atan2(-f.dz, f.dx);
    const logs = Math.max(1, Math.min(4, Math.round(tree.height * TRUNK[tree.species] / LOG_LENGTH)));
    const at = new THREE.Vector3();
    for (let k = 0; k < logs; k++) {
      at.copy(f.pivot).addScaledVector(dir, 0.4 + LOG_LENGTH * (k + 0.5) * 1.04);
      spawn('log', tree.species, at.x, at.y + 0.25, at.z, yaw + (rng() - 0.5) * 0.15);
    }
    const crown = f.pivot.clone().addScaledVector(dir, tree.height * 0.7);
    const sticks = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < sticks; k++) {
      dropItem({ id: 'stick', count: 1 }, new THREE.Vector3(crown.x + (rng() - 0.5) * 3, crown.y + 0.4, crown.z + (rng() - 0.5) * 3), new THREE.Vector3(0, 0.5, 0));
    }
    onSound?.('break', 1);
  }

  function updateFelling(dt, t, player) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const f = falling[i];
      if (f.down > 0) {
        if ((f.down -= dt) <= 0) {
          breakUp(f);
          falling.splice(i, 1);
        }
        continue;
      }
      // A toppling pole: slow at first, faster the further it leans.
      f.speed += (1.5 * 9.8 / Math.max(3, f.tree.height * 0.6)) * Math.sin(f.angle) * dt;
      const before = f.angle;
      f.angle += f.speed * dt;
      if (touchesGround(f) || f.angle > 2.2) {
        f.angle = before;
        if (!f.landed) {
          f.landed = true;
          onSound?.('thud', Math.min(1, f.tree.height / 18));
        }
        // A small bounce, then it lies still.
        f.speed = -f.speed * 0.2;
        if (Math.abs(f.speed) < 0.25) {
          f.speed = 0;
          f.down = 1.2;
        }
      }
      lean(f.handle, f.pivot, f.dx, f.dz, f.angle);
    }
    // Trees being chopped shudder at each blow. Walk away and they go back
    // into the forest (the cuts stay).
    for (const [tree, c] of chopping) {
      if (c.shake > 0) {
        c.shake = Math.max(0, c.shake - dt * 2.5);
        lean(c.handle, tree, c.dx, c.dz, 0.03 * c.shake * Math.sin(t * 32));
      } else if ((tree.x - player.pos.x) ** 2 + (tree.z - player.pos.z) ** 2 > (forest.detailRange - 3) ** 2) {
        c.handle.remove();
        chopping.delete(tree);
      }
    }
  }

  // --- Splitting and carrying.
  function split(p) {
    p.chops++;
    onSound?.('chop', 0.8);
    if (p.chops < SPLIT_CHOPS) {
      p.vel.y = 1.2;   // it jumps under the blow
      p.asleep = false;
      return;
    }
    // Into planks, falling apart either side of the log.
    removePiece(p);
    const sx = Math.sin(p.yaw), sz = Math.cos(p.yaw);
    for (let k = 0; k < PLANKS_PER_LOG; k++) {
      const off = k - (PLANKS_PER_LOG - 1) / 2;
      spawn('plank', null, p.pos.x + sx * off * 0.16, p.pos.y + 0.1, p.pos.z + sz * off * 0.16,
        p.yaw + (rng() - 0.5) * 0.3, sx * off * 1.1, 1.6 + rng(), sz * off * 1.1, (rng() - 0.5) * 2);
    }
    onSound?.('split', 1);
  }

  const carrying = () => (carried.length ? { kind: carried[0].kind, count: carried.length } : null);

  function pickUp(p) {
    removePiece(p);
    carried.push(p);
    onSound?.('plank', 0.4);
  }

  // Puts down the last thing picked up, an arm's length in front of you and
  // across your path. from: your eyes; dir: where you're looking.
  function putDown(from, dir, vel) {
    const p = carried.pop();
    if (!p) return false;
    const l = Math.hypot(dir.x, dir.z) || 1, fx = dir.x / l, fz = dir.z / l;
    p.pos.set(from.x + fx * 1.1, from.y - 0.7, from.z + fz * 1.1);
    p.vel.set(fx * 1.5 + vel.x, 0.8, fz * 1.5 + vel.z);
    p.yaw = Math.atan2(-fz, fx) + Math.PI / 2;
    p.pitch = 0;
    p.spin = 0;
    add(p);
    return true;
  }

  // What's under the crosshair (or close in front of you): the piece and a
  // score to weigh it against other things you could be looking at.
  const near = {}, a = new THREE.Vector3();
  function aimAt(ray) {
    let best = null, bestScore = -Infinity;
    for (const p of pieces) {
      if ((p.pos.x - ray.origin.x) ** 2 + (p.pos.z - ray.origin.z) ** 2 > 36) continue;
      a.set(Math.cos(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.sin(p.yaw) * Math.cos(p.pitch));
      raySegment(ray.origin, ray.direction, p.pos, a, length(p) / 2, near);
      const slack = near.dist - aimRadius(p) - 0.12;
      if (near.t > REACH || slack > 0.4) continue;
      const score = 3 - near.t * 0.3 - Math.max(0, slack) * 3;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best && { piece: best, score: bestScore };
  }

  // A piece under the crosshair: E picks it up, and a swing of the axe
  // (with your arms empty) splits a log.
  function focusOn(p, score, tool) {
    const held = carrying();
    const name = woodName(p.kind);
    if (held && (held.kind !== p.kind || held.count >= CARRY[held.kind])) {
      const full = held.kind === p.kind ? `You can’t carry more than ${CARRY[held.kind]} ${woodName(held.kind, 2)}` : 'Your arms are full';
      return { score, key: p, dim: true, prompt: [['E', full], ['Q', 'Put one down']] };
    }
    const count = held ? ` (${held.count + 1}/${CARRY[p.kind]})` : '';
    const splits = p.kind === 'log' && tool === 'axe' && !held;
    return {
      score, key: p,
      prompt: [['E', `Pick up ${name}${count}`], ...(splits ? [['Right-click', `Split into planks (${p.chops}/${SPLIT_CHOPS})`]] : [])],
      act: () => {
        pickUp(p);
        return {};
      },
      use: splits
        ? () => {
          if (!pieces.includes(p)) return null;   // picked up mid-swing
          split(p);
          return { used: true };
        }
        : null,
    };
  }

  return {
    chop,
    chopProgress: (tree) => [tree.chops ?? 0, chopsNeeded(tree)],

    // A log cut off a fallen trunk.
    spawnLog(x, y, z, yaw, bark) { spawn('log', bark, x, y, z, yaw, 0, 1, 0); },

    // Wood set free from something built (taken apart, or broken up by the
    // weather or the sea): [{ x, y, z, yaw, kind, bark }], planks by default.
    release(list) {
      for (const { x, y, z, yaw, kind = 'plank', bark = null } of list) {
        spawn(kind, kind === 'log' ? bark : null, x, y, z, yaw, (rng() - 0.5) * 1.5, 0.5 + rng(), (rng() - 0.5) * 1.5, (rng() - 0.5) * 2);
      }
    },

    // What you're carrying: { kind, count }, or null.
    get carrying() { return carrying(); },
    // The pieces themselves (for drawing them in your arms).
    carried,
    // How much the load slows you: 0 empty-handed .. 1 with two logs.
    get burden() {
      const held = carrying();
      if (!held) return 0;
      return held.kind === 'log' ? held.count / CARRY.log : 0.4 * held.count / CARRY.plank;
    },
    // Uses up one carried piece of this kind (going into a build or a
    // repair) and returns it, or null if you're not carrying one.
    take(kind) {
      return carried.at(-1)?.kind === kind ? carried.pop() : null;
    },
    putDown,
    // Everything you carry falls where you stand (you blacked out).
    dropAll(at) {
      while (carried.length) {
        const p = carried.pop();
        p.pos.set(at.x + (rng() - 0.5) * 1.5, at.y + 1, at.z + (rng() - 0.5) * 1.5);
        p.vel.set(0, 0, 0);
        add(p);
      }
    },
    // Something under the pieces changed (a floor came down): let them fall.
    wake() { for (const p of pieces) p.asleep = false; },

    update(dt, t, player) {
      updateFelling(dt, t, player);
      for (const p of pieces) if (simulate(p, dt, t)) changed = true;
      if (changed) {
        changed = false;
        render();
      }
    },

    // The piece you're looking at, as { score, prompt, dim, act }.
    focus(ray, tool) {
      const hit = aimAt(ray);
      return hit && focusOn(hit.piece, hit.score, tool);
    },

    get count() { return { logs: pieces.filter((p) => p.kind === 'log').length, planks: pieces.filter((p) => p.kind === 'plank').length, stumps: stumps.length, falling: falling.length }; },
  };
}
