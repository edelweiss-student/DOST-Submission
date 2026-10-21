import * as THREE from 'three';
import { uniforms } from '../shared.js';
import { ITEMS } from '../items/items.js';
import { lyingGeometry, REST } from '../items/models.js';
import { patchMaterial } from './materials.js';
import { SPECIES } from './trees.js';

const REACH = 2.4;          // how far past an object's edge you can reach (m)
const MAX_DROPPED = 150;    // oldest dropped items vanish past this

// What each kind of source gives. stock: gathers before it runs out;
// regrow: seconds of game time for one gather to come back (grass never
// runs out). tool: the tool that does better here; label and give(rng,
// { tool, dead }) depend on whether it's the one selected.
const SOURCES = {
  tree: {
    stock: 3, regrow: 90, tool: 'axe',
    label: (axe) => (axe ? 'Chop wood' : 'Gather sticks'),
    give: (r, { tool }) => (tool ? [['wood', r() < 0.5 ? 2 : 1], ['stick', r() < 0.4 ? 1 : 0]] : [['stick', r() < 0.5 ? 2 : 1]]),
  },
  bush: {
    stock: 3, regrow: 120, tool: 'knife',
    label: (knife) => (knife ? 'Cut fibre and berries' : 'Gather fibre and berries'),
    // Bushes the sea has killed have no berries left, only dry stems.
    give: (r, { tool, dead }) => [
      ['fibre', (r() < 0.4 ? 2 : 1) * (tool ? 2 : 1)],
      ...(!dead && r() < 0.6 ? [['berries', r() < 0.3 ? 2 : 1]] : []),
    ],
  },
  rock: {
    stock: 4, regrow: 300, tool: 'pickaxe',
    label: (pickaxe) => (pickaxe ? 'Mine stones' : 'Pick up stones'),
    give: (r, { tool }) => [['stone', (r() < 0.3 ? 2 : 1) * (tool ? 2 : 1)]],
  },
  log: {
    stock: 5, regrow: 600, tool: 'axe',
    label: (axe) => (axe ? 'Chop wood' : 'Break off wood'),
    give: (r, { tool }) => [['wood', tool ? 2 : 1]],
  },
  grass: {
    tool: 'knife', label: () => 'Cut grass',
    give: (r) => [['fibre', r() < 0.35 ? 2 : 1]],
  },
};

class Grid {
  constructor(cell = 8) { this.cell = cell; this.cells = new Map(); }
  key(x, z) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }
  add(x, z, item) {
    const k = this.key(x, z);
    if (!this.cells.has(k)) this.cells.set(k, []);
    const list = this.cells.get(k);
    if (!list.includes(item)) list.push(item);
  }
  near(x, z, out) {
    out.length = 0;
    const ci = Math.floor(x / this.cell), cj = Math.floor(z / this.cell);
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const list = this.cells.get(`${i},${j}`);
        if (list) out.push(...list);
      }
    }
    return out;
  }
}

// Gathering from trees, bushes, boulders, fallen trunks and (with a knife)
// grass, and items lying in the world (dropped, or thrown out of a full
// bag). Stones and tools sink; everything else floats, drifting with the
// waves and the wind.
export function createGathering(scene, { terrain, water, vegetation, inventory, rng }) {
  const grid = new Grid();
  const { trees, bushes, rocks, logs } = vegetation.sources;
  for (const t of trees) grid.add(t.x, t.z, { kind: 'tree', x: t.x, z: t.z, r: SPECIES[t.species].trunk * t.s });
  for (const b of bushes) grid.add(b.x, b.z, { kind: 'bush', x: b.x, z: b.z, y: b.y, r: 1.1 * b.s });
  for (const r of rocks) grid.add(r.x, r.z, { kind: 'rock', x: r.x, z: r.z, r: 0.9 * Math.max(r.sx, r.sz) });
  for (const l of logs) {
    const source = { kind: 'log', x: l.x, z: l.z, dx: l.dx, dz: l.dz, len: l.len, r: 0.55 * l.s };
    for (let d = 0; d <= l.len; d += 4) grid.add(l.x + l.dx * d, l.z + l.dz * d, source);
  }
  const grass = { kind: 'grass' };

  // --- Items in the world: one instanced mesh per item type, one material.
  const dropped = [];
  const meshes = {};
  const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'world-item', snowMin: 0.6 });
  for (const id of Object.keys(ITEMS)) {
    const mesh = new THREE.InstancedMesh(lyingGeometry(id), material, MAX_DROPPED);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    meshes[id] = mesh;
  }

  // stack: { id, count } plus a tool's durability, which it keeps.
  function drop(stack, from, velocity) {
    if (dropped.length >= MAX_DROPPED) dropped.shift();
    dropped.push({ ...stack, pos: from.clone(), vel: velocity.clone(), yaw: rng() * 6.28, spin: 0 });
  }

  const surf = {};
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const Y = new THREE.Vector3(0, 1, 0);
  function updateDropped(dt, t) {
    const wind = uniforms.uWind.value, wd = uniforms.uWindDir.value;
    const counts = {};
    for (const it of dropped) {
      const p = it.pos, v = it.vel;
      const ground = terrain.heightAt(p.x, p.z) + REST[it.id];
      water.surface(p.x, p.z, t, surf);
      if (p.y < surf.height && ITEMS[it.id].floats && surf.height - 0.02 > ground) {
        // Floating: ride the surface, pushed by the waves and the wind.
        p.y += (surf.height - 0.02 - p.y) * Math.min(1, dt * 6);
        v.set(surf.vx * 0.6 + wd.x * wind * 0.5, 0, surf.vz * 0.6 + wd.y * wind * 0.5);
        it.spin = 0.3 * wind;
      } else {
        v.y -= 9.8 * dt;
        if (p.y < surf.height) v.multiplyScalar(Math.exp(-3 * dt));   // sinking through the water
        it.spin = 0;
      }
      p.addScaledVector(v, dt);
      if (p.y <= ground) {
        p.y = ground;
        v.set(0, 0, 0);
      }
      it.yaw += it.spin * dt;
      const mesh = meshes[it.id];
      const i = (counts[it.id] = (counts[it.id] ?? 0) + 1) - 1;
      mesh.setMatrixAt(i, m.compose(p, q.setFromAxisAngle(Y, it.yaw), one));
    }
    for (const [id, mesh] of Object.entries(meshes)) {
      mesh.count = counts[id] ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Gathered sources come back over time (game time, so not while paused).
  function restock(s, t) {
    const kind = SOURCES[s.kind];
    if (!kind.stock) return;
    if (s.stock === undefined) { s.stock = kind.stock; s.since = t; }
    if (s.stock >= kind.stock) { s.since = t; return; }
    const back = Math.floor((t - s.since) / kind.regrow);
    if (back > 0) {
      s.stock = Math.min(kind.stock, s.stock + back);
      s.since += back * kind.regrow;
    }
  }

  // What you're looking at within reach: dropped items first, then
  // sources, then (holding a knife) the grass in front of you.
  const found = [];
  const fwd = new THREE.Vector3();
  function findTarget(player, camera, tool) {
    camera.getWorldDirection(fwd);
    const fl = Math.hypot(fwd.x, fwd.z) || 1;
    const fx = fwd.x / fl, fz = fwd.z / fl;
    const px = player.pos.x, pz = player.pos.z, py = player.pos.y;
    let best = null, bestScore = -Infinity;
    const consider = (target, cx, cz, gap, bonus) => {
      const dx = cx - px, dz = cz - pz, d = Math.hypot(dx, dz);
      const facing = d > 0.05 ? (dx * fx + dz * fz) / d : 1;
      if (gap > REACH || (facing < 0.5 && gap > 0.3)) return;
      const score = facing * 2 - gap + bonus;
      if (score > bestScore) { bestScore = score; best = target; }
    };
    for (const it of dropped) {
      if (Math.abs(it.pos.y - (py + 0.9)) > 2.6) continue;
      consider({ item: it }, it.pos.x, it.pos.z, Math.hypot(it.pos.x - px, it.pos.z - pz), 1);
    }
    for (const s of grid.near(px, pz, found)) {
      let cx = s.x, cz = s.z;
      if (s.kind === 'log') {
        // Nearest point along the trunk.
        const k = Math.max(0, Math.min(s.len, (px - s.x) * s.dx + (pz - s.z) * s.dz));
        cx = s.x + s.dx * k;
        cz = s.z + s.dz * k;
      }
      consider({ source: s }, cx, cz, Math.hypot(cx - px, cz - pz) - s.r, 0);
    }
    if (!best && tool === 'knife' && !player.swimming) {
      const gx = px + fx * 1.5, gz = pz + fz * 1.5;
      if (terrain.grassAt(gx, gz) > 0.3 && terrain.heightAt(gx, gz) > uniforms.uWaterLevel.value + 0.3) best = { source: grass };
    }
    return best;
  }

  let target = null;
  return {
    drop,

    // Called every frame: finds what E would act on, for the prompt.
    // tool: the selected tool's kind, if any.
    update(dt, t, simTime, player, camera, playing, tool) {
      updateDropped(dt, t);
      target = playing ? findTarget(player, camera, tool) : null;
      if (!target) return null;
      if (target.item) {
        const { id, count } = target.item;
        return { text: `Pick up ${ITEMS[id].name}${count > 1 ? ` ×${count}` : ''}`, dim: false };
      }
      const s = target.source, kind = SOURCES[s.kind];
      restock(s, simTime);
      const empty = kind.stock && s.stock <= 0;
      return { text: empty ? 'Nothing left here for now' : kind.label(tool === kind.tool), dim: !!empty };
    },

    // E: pick up or gather. Returns what went into the bag ([{ id, count }]),
    // whether the bag was full or the source empty, and whether the
    // selected tool was used (so it wears).
    interact(simTime, tool) {
      if (!target) return null;
      const got = [];
      let full = false;
      const give = (stack) => {
        const left = inventory.addStack(stack);
        if (stack.count > left) got.push({ id: stack.id, count: stack.count - left });
        if (left) full = true;
        return left;
      };
      if (target.item) {
        const it = target.item;
        it.count = give({ id: it.id, count: it.count, durability: it.durability });
        if (it.count === 0) dropped.splice(dropped.indexOf(it), 1);
        return { got, full };
      }
      const s = target.source, kind = SOURCES[s.kind];
      restock(s, simTime);
      if (kind.stock && s.stock <= 0) return { got, empty: true };
      const usedTool = tool === kind.tool;
      const dead = s.kind === 'bush' && uniforms.uTreeKillLine.value > s.y;
      let added = 0;
      for (const [id, count] of kind.give(rng, { tool: usedTool, dead })) {
        if (count > 0) added += count - give({ id, count });
      }
      if (added === 0) return { got, full: true };
      if (kind.stock) s.stock--;
      return { got, full, usedTool };
    },

    get count() { return dropped.length; },
  };
}
