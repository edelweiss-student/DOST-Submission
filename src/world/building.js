import * as THREE from 'three';
import { uniforms } from '../shared.js';
import { boardGeometry } from './wood.js';

// Building with planks. Pieces snap to a 2 m grid: floors on posts (on
// land or out over the water), walls and doorways along a floor's edges,
// and pitched roofs over floors. A piece is first placed as a blueprint,
// then built up a plank at a time (you bring them in your arms, see
// timber.js). Finished, it's solid: you stand on floors, walls stop you
// and roofs give shade. The sea wears down what's built near it; worn
// through, a piece breaks up and its planks float away.

export const CELL = 2;             // the building grid (m); a floor fills one cell
export const WALL_HEIGHT = 2.4;
const DOOR = { width: 0.95, height: 2 };
const RISE = 0.95;                 // roof ridge above the walls (m)
const EAVE = 0.3;                  // roof overhang past the walls (m)
const MAX_POST = 5;                // longest post under a floor (m)
const REACH = 4;                   // from your eyes (m)
const MAX_SOLID = 6000, MAX_GHOST = 3000;
const HALF_PI = Math.PI / 2;

// What can be built. cost: planks to finish it.
export const PIECES = [
  { id: 'floor', name: 'Floor', cost: 6, hint: 'On posts, on land or over the water' },
  { id: 'wall', name: 'Wall', cost: 6, hint: 'Along the edge of a floor' },
  { id: 'doorway', name: 'Doorway', cost: 4, hint: 'A wall you can walk through' },
  { id: 'roof', name: 'Roof', cost: 8, hint: 'Over a floor; shade from the sun' },
];
const PIECE = Object.fromEntries(PIECES.map((p) => [p.id, p]));

const cellKey = (i, j) => `${i},${j}`;
// A cell's edge by side (0 south, 1 east, 2 north, 3 west), keyed so the
// two cells either side of it share it.
function edgeOf(i, j, side) {
  const x0 = i * CELL, z0 = j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  switch (side) {
    case 0: return { key: `x${i},${j}`, ax: x0, az: z0, bx: x1, bz: z0 };
    case 1: return { key: `z${i + 1},${j}`, ax: x1, az: z0, bx: x1, bz: z1 };
    case 2: return { key: `x${i},${j + 1}`, ax: x0, az: z1, bx: x1, bz: z1 };
    default: return { key: `z${i},${j}`, ax: x0, az: z0, bx: x0, bz: z1 };
  }
}

// --- The parts of each piece: boards (scaled unit boxes, the grain along
// their local X), each appearing at a step: how many planks have gone in.
const e = new THREE.Euler(0, 0, 0, 'YXZ'), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
function board(parts, step, x, y, z, sx, sy, sz, yaw = 0, tilt = 0, roll = 0) {
  e.set(tilt, yaw, roll);
  parts.push({ step, matrix: new THREE.Matrix4().compose(pos.set(x, y, z), q.setFromEuler(e), scl.set(sx, sy, sz)) });
}

// A deck of six boards on two joists and four posts down to the ground.
function floorParts(terrain, x0, z0, y) {
  const parts = [];
  const joist = y - 0.14;
  for (const [px, pz] of [[0.12, 0.12], [1.88, 0.12], [0.12, 1.88], [1.88, 1.88]]) {
    const bottom = terrain.heightAt(x0 + px, z0 + pz) - 0.3, top = joist - 0.07;
    if (top - bottom > 0.05) board(parts, 1, x0 + px, (top + bottom) / 2, z0 + pz, top - bottom, 0.16, 0.16, 0, 0, HALF_PI);
  }
  for (const px of [0.12, 1.88]) board(parts, 1, x0 + px, joist, z0 + 1, CELL, 0.14, 0.14, HALF_PI);
  for (let k = 0; k < 6; k++) board(parts, k + 1, x0 + 1, y - 0.035, z0 + (k + 0.5) / 3, CELL + 0.04, 0.07, 0.32);
  return parts;
}

// Six boards on edge between two corner posts; a doorway leaves a gap
// below the top board.
function wallParts({ ax, az, bx, bz }, y, door) {
  const parts = [];
  const ux = (bx - ax) / CELL, uz = (bz - az) / CELL;
  const yaw = Math.atan2(-uz, ux);
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  // Posts just inside the ends, so walls meeting at a corner don't share one.
  const post = uz === 0 ? 0.14 : 0.15;
  for (const k of [0.07, CELL - 0.07]) board(parts, 1, ax + ux * k, y + WALL_HEIGHT / 2, az + uz * k, WALL_HEIGHT + (uz === 0 ? 0 : 0.01), post, post, yaw, 0, HALF_PI);
  const rows = 6, rowH = WALL_HEIGHT / rows;
  if (door) {
    for (const sgn of [-1, 1]) {
      const k = sgn * (DOOR.width / 2 + 0.05);
      board(parts, 1, mx + ux * k, y + DOOR.height / 2, mz + uz * k, DOOR.height, 0.1, 0.1, yaw, 0, HALF_PI);
    }
  }
  const side = (CELL - DOOR.width) / 2;
  for (let r = 0; r < rows; r++) {
    const cy = y + (r + 0.5) * rowH;
    if (!door) {
      board(parts, r + 1, mx, cy, mz, CELL, rowH - 0.02, 0.07, yaw);
    } else if (cy < y + DOOR.height) {
      const step = r < 2 ? 1 : r < 4 ? 2 : 3;
      for (const sgn of [-1, 1]) {
        const k = sgn * (CELL - side) / 2;
        board(parts, step, mx + ux * k, cy, mz + uz * k, side, rowH - 0.02, 0.07, yaw);
      }
    } else {
      board(parts, 4, mx, cy, mz, CELL, rowH - 0.02, 0.07, yaw);
    }
  }
  return parts;
}

// A pitched roof: a ridge beam, the gable ends boarded up, five boards down
// each slope and a ridge cap. dir 0 runs the ridge along X, 1 along Z.
function roofParts(x0, z0, y, dir) {
  const parts = [];
  const cx = x0 + CELL / 2, cz = z0 + CELL / 2, half = CELL / 2;
  const slope = Math.atan2(RISE, half);
  const run = (half + EAVE) / Math.cos(slope);
  const yaw = dir ? HALF_PI : 0;
  // In the roof's own frame: lx along the ridge, lz across it.
  const add = (step, lx, ly, lz, sx, sy, sz, tilt = 0, roll = 0) =>
    board(parts, step, dir ? cx + lz : cx + lx, ly, dir ? cz - lx : cz + lz, sx, sy, sz, yaw, tilt, roll);
  add(1, 0, y + RISE - 0.08, 0, CELL + 0.1, 0.12, 0.12);
  for (const [end, step] of [[-half, 1], [half, 2]]) {
    for (let k = 0; k < 6; k++) {
      const lz = -half + (k + 0.5) * (CELL / 6);
      const h = RISE * (1 - Math.abs(lz) / half);
      add(step, end, y + h / 2, lz, h, 0.07, CELL / 6 - 0.01, 0, HALF_PI);
    }
  }
  const boards = 5, width = run / boards;
  let k = 0;
  for (const side of [1, -1]) {
    for (let b = 0; b < boards; b++) {
      const s = (b + 0.5) * width;   // down the slope from the ridge
      add(3 + Math.floor(k++ / 2), 0, y + RISE - s * Math.sin(slope) + 0.05, side * s * Math.cos(slope), CELL + 0.2, 0.06, width - 0.015, side * slope);
    }
  }
  add(8, 0, y + RISE + 0.07, 0, CELL + 0.24, 0.08, 0.22);
  return parts;
}

// Bounds of a list of boards, for aiming at them.
function bounds(parts, box = new THREE.Box3()) {
  box.makeEmpty();
  const c = new THREE.Vector3(), h = new THREE.Vector3();
  for (const { matrix } of parts) {
    const el = matrix.elements;
    c.set(el[12], el[13], el[14]);
    // Half-extent of a transformed unit box: half the absolute columns, summed.
    h.set(
      (Math.abs(el[0]) + Math.abs(el[4]) + Math.abs(el[8])) / 2,
      (Math.abs(el[1]) + Math.abs(el[5]) + Math.abs(el[9])) / 2,
      (Math.abs(el[2]) + Math.abs(el[6]) + Math.abs(el[10])) / 2,
    );
    box.expandByPoint(c.clone().sub(h));
    box.expandByPoint(c.add(h));
  }
  return box;
}

// Pushes a circle (the player) out of a wall segment.
function pushFromSegment(p, r, s) {
  const vx = s.bx - s.ax, vz = s.bz - s.az;
  const k = Math.max(0, Math.min(1, ((p.x - s.ax) * vx + (p.z - s.az) * vz) / (vx * vx + vz * vz)));
  const cx = s.ax + vx * k, cz = s.az + vz * k;
  let dx = p.x - cx, dz = p.z - cz;
  const d = Math.hypot(dx, dz), min = r + 0.08;
  if (d >= min) return;
  if (d < 1e-5) {
    dx = -vz;
    dz = vx;
  }
  const l = Math.hypot(dx, dz);
  p.x = cx + (dx / l) * min;
  p.z = cz + (dz / l) * min;
}

// ...and out of a floor's deck, when it's too high to step onto.
function pushFromRect(p, r, x0, z0, x1, z1) {
  const cx = Math.max(x0, Math.min(x1, p.x)), cz = Math.max(z0, Math.min(z1, p.z));
  const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    p.x = cx + (dx / d) * r;
    p.z = cz + (dz / d) * r;
    return;
  }
  const out = Math.min(p.x - x0, x1 - p.x, p.z - z0, z1 - p.z);
  if (out === p.x - x0) p.x = x0 - r;
  else if (out === x1 - p.x) p.x = x1 + r;
  else if (out === p.z - z0) p.z = z0 - r;
  else p.z = z1 + r;
}

// takePlank(): uses up a plank you're carrying (false if you have none).
// release([{ x, y, z, yaw }]): planks back into the world.
// onMessage(text), onSound(name, strength), onChange(): something was
// built or taken down (things lying on it may need to fall).
export function createBuilding(scene, { terrain, colliders, wood, rng, shadows, takePlank, release, onMessage, onSound, onChange }) {
  const cells = new Map();   // floors by grid cell: { i, j, x0, z0, y, floor, roof }
  const edges = new Map();   // walls and doorways by edge key
  const pieces = [];
  let dirty = true;

  // --- Drawing: built boards, blueprints still to fill, and the placement preview.
  const boardGeo = boardGeometry();
  const solid = new THREE.InstancedMesh(boardGeo, wood.plank, MAX_SOLID);
  solid.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SOLID * 3), 3);
  const ghost = new THREE.InstancedMesh(boardGeo, wood.ghost, MAX_GHOST);
  const previewMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, fog: false });
  const preview = new THREE.InstancedMesh(boardGeo, previewMat, 40);
  for (const mesh of [solid, ghost, preview]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  solid.castShadow = shadows;
  solid.receiveShadow = true;
  ghost.renderOrder = preview.renderOrder = 2;

  const color = new THREE.Color(), grey = new THREE.Color();
  function render() {
    let s = 0, g = 0;
    for (const piece of pieces) {
      // Sea-worn wood goes grey and dark.
      const worn = 1 - piece.health;
      piece.shownHealth = piece.health;
      for (const part of piece.parts) {
        if (piece.done || part.step <= piece.planks) {
          if (s >= MAX_SOLID) continue;
          solid.setMatrixAt(s, part.matrix);
          color.setRGB(part.tone, part.tone * 0.97, part.tone * 0.92).lerp(grey.setScalar(part.tone * 0.8), 0.8 * worn);
          solid.setColorAt(s++, color.multiplyScalar(1 - 0.35 * worn));
        } else if (g < MAX_GHOST) {
          ghost.setMatrixAt(g++, part.matrix);
        }
      }
    }
    solid.count = s;
    ghost.count = g;
    solid.instanceMatrix.needsUpdate = true;
    solid.instanceColor.needsUpdate = true;
    ghost.instanceMatrix.needsUpdate = true;
  }

  // --- Placing: where a piece would go, from what you're aiming at.
  const hit = new THREE.Vector3();
  // The ground (or the sea) under the crosshair, by stepping along the ray.
  function groundHit(ray, max) {
    const o = ray.origin, d = ray.direction, sea = uniforms.uWaterLevel.value;
    for (let t = 0.2; t <= max; t += 0.1) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const g = Math.max(terrain.heightAt(x, z), sea);
      if (y <= g) return hit.set(x, g, z);
    }
    return null;
  }
  // The floor (built or planned) under the crosshair; with `above`, also
  // the space over it up to the top of the walls (for roofs).
  function floorHit(ray, above) {
    const o = ray.origin, d = ray.direction;
    let best = null;
    for (const c of cells.values()) {
      for (const y of above ? [c.y, c.y + WALL_HEIGHT] : [c.y]) {
        const t = (y - o.y) / d.y;
        if (!(t > 0.1 && t < REACH + 2)) continue;
        const x = o.x + d.x * t, z = o.z + d.z * t;
        if (x < c.x0 - 0.05 || x > c.x0 + CELL + 0.05 || z < c.z0 - 0.05 || z > c.z0 + CELL + 0.05) continue;
        if (!best || t < best.t) best = { cell: c, x, z, t };
      }
    }
    return best;
  }
  // Trunks, stumps and boulders in the way of a floor.
  const found = [];
  function blocked(x0, z0) {
    return colliders.query(x0 + CELL / 2, z0 + CELL / 2, found).some((c) => {
      const dx = Math.max(x0 - c.x, 0, c.x - x0 - CELL), dz = Math.max(z0 - c.z, 0, c.z - z0 - CELL);
      return dx * dx + dz * dz < c.r * c.r;
    });
  }

  function planFloor(ray) {
    if (!groundHit(ray, 9)) return null;
    let i = Math.floor(hit.x / CELL), j = Math.floor(hit.z / CELL);
    // Aiming at a floor that's already there: the next cell along, the way you're looking.
    if (cells.has(cellKey(i, j))) {
      const d = ray.direction;
      if (Math.abs(d.x) > Math.abs(d.z)) i += Math.sign(d.x);
      else j += Math.sign(d.z);
    }
    const x0 = i * CELL, z0 = j * CELL;
    let high = -Infinity, low = Infinity;
    for (const [px, pz] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
      const h = terrain.heightAt(x0 + px * CELL, z0 + pz * CELL);
      high = Math.max(high, h);
      low = Math.min(low, h);
    }
    let y = Math.max(high, uniforms.uWaterLevel.value + 0.4) + 0.25;
    // Level with a floor next to it, if that's close and clears the ground.
    let nearest = Infinity;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = cells.get(cellKey(i + di, j + dj));
      const gap = n ? Math.abs(n.y - y) : Infinity;
      if (gap < 1.3 && gap < nearest && n.y > high + 0.1) {
        nearest = gap;
        y = n.y;
      }
    }
    const plan = { type: 'floor', i, j, x0, z0, y, parts: floorParts(terrain, x0, z0, y) };
    if (cells.has(cellKey(i, j))) return { ...plan, reason: 'There’s a floor here already' };
    if (y - low > MAX_POST) return { ...plan, reason: 'Too high off the ground here' };
    if (blocked(x0, z0)) return { ...plan, reason: 'Something’s in the way' };
    return { ...plan, ok: true };
  }

  function planWall(type, ray) {
    const h = floorHit(ray, false);
    if (!h) return null;
    const c = h.cell;
    // The edge of the floor nearest the crosshair.
    const fx = h.x - c.x0, fz = h.z - c.z0;
    const near = [fz, CELL - fx, CELL - fz, fx];
    const edge = edgeOf(c.i, c.j, near.indexOf(Math.min(...near)));
    const plan = { type, cell: c, edge, y: c.y, parts: wallParts(edge, c.y, type === 'doorway') };
    if (edges.has(edge.key)) return { ...plan, reason: 'There’s a wall here already' };
    return { ...plan, ok: true };
  }

  function planRoof(ray, dir) {
    const h = floorHit(ray, true);
    if (!h) return null;
    const c = h.cell;
    const plan = { type: 'roof', cell: c, dir, y: c.y + WALL_HEIGHT, parts: roofParts(c.x0, c.z0, c.y + WALL_HEIGHT, dir) };
    if (c.roof) return { ...plan, reason: 'There’s a roof here already' };
    return { ...plan, ok: true };
  }

  // --- Building up and taking down.
  function place(plan) {
    const piece = {
      type: plan.type, cost: PIECE[plan.type].cost, planks: 0, done: false, health: 1, shownHealth: 1,
      parts: plan.parts.map((part) => ({ ...part, tone: 0.86 + rng() * 0.24 })),
      // Floors are aimed at by the deck, not the posts under it.
      box: plan.type === 'floor'
        ? new THREE.Box3(new THREE.Vector3(plan.x0, plan.y - 0.3, plan.z0), new THREE.Vector3(plan.x0 + CELL, plan.y, plan.z0 + CELL))
        : bounds(plan.parts),
    };
    if (plan.type === 'floor') {
      const cell = { i: plan.i, j: plan.j, x0: plan.x0, z0: plan.z0, y: plan.y, floor: piece, roof: null };
      cells.set(cellKey(plan.i, plan.j), cell);
      piece.cell = cell;
      piece.low = plan.y - 0.21;   // the underside of the deck (the posts are meant to stand in water)
    } else if (plan.type === 'roof') {
      plan.cell.roof = piece;
      piece.cell = plan.cell;
      piece.low = plan.y;
    } else {
      edges.set(plan.edge.key, piece);
      piece.cell = plan.cell;
      piece.edge = plan.edge;
      piece.low = plan.y;
    }
    piece.center = piece.box.getCenter(new THREE.Vector3());
    pieces.push(piece);
    dirty = true;
    return piece;
  }

  // Finished: what makes it solid.
  function complete(piece) {
    piece.done = true;
    const { cell } = piece;
    if (piece.type === 'floor') {
      piece.deck = { x0: cell.x0, z0: cell.z0, x1: cell.x0 + CELL, z1: cell.z0 + CELL, top: cell.y, bottom: cell.y - 0.21 };
    } else if (piece.edge) {
      const { ax, az, bx, bz } = piece.edge, y = piece.low;
      if (piece.type === 'wall') {
        piece.segments = [{ ax, az, bx, bz, y0: y, y1: y + WALL_HEIGHT }];
      } else {
        // Either side of the opening, and the lintel over it.
        const ux = (bx - ax) / CELL, uz = (bz - az) / CELL, side = (CELL - DOOR.width) / 2;
        piece.segments = [
          { ax, az, bx: ax + ux * side, bz: az + uz * side, y0: y, y1: y + WALL_HEIGHT },
          { ax: bx - ux * side, az: bz - uz * side, bx, bz, y0: y, y1: y + WALL_HEIGHT },
          { ax, az, bx, bz, y0: y + DOOR.height, y1: y + WALL_HEIGHT },
        ];
      }
    }
    onChange?.();
  }

  function addPlank(piece) {
    if (!takePlank()) return { message: 'You need planks: split logs with an axe and carry them here.' };
    piece.planks++;
    dirty = true;
    onSound?.('knock', 0.8);
    if (piece.planks < piece.cost) return {};
    complete(piece);
    return { notify: `Built a ${PIECE[piece.type].name.toLowerCase()}` };
  }

  // What stands on a floor: walls along its edges that no other floor
  // holds up, and its roof.
  function standingOn(floor) {
    const { i, j } = floor.cell;
    const on = [];
    for (const [side, di, dj] of [[0, 0, -1], [1, 1, 0], [2, 0, 1], [3, -1, 0]]) {
      const wall = edges.get(edgeOf(i, j, side).key);
      if (wall && !cells.has(cellKey(i + di, j + dj))) on.push(wall);
    }
    if (floor.cell.roof) on.push(floor.cell.roof);
    return on;
  }

  function unregister(piece) {
    pieces.splice(pieces.indexOf(piece), 1);
    if (piece.type === 'floor') {
      cells.delete(cellKey(piece.cell.i, piece.cell.j));
    } else if (piece.type === 'roof') {
      piece.cell.roof = null;
    } else {
      edges.delete(piece.edge.key);
    }
    dirty = true;
    onChange?.();
  }

  // The planks in a piece come back into the world, where its boards were.
  function free(piece, count) {
    const list = [];
    for (let k = 0; k < count; k++) {
      const el = piece.parts[(piece.parts.length - 1 - k * 2) % piece.parts.length].matrix.elements;
      list.push({ x: el[12] + (rng() - 0.5) * 0.4, y: el[13] + 0.2, z: el[14] + (rng() - 0.5) * 0.4, yaw: rng() * Math.PI });
    }
    release(list);
  }

  // Hold X: take a piece apart (or cancel a blueprint), getting the planks back.
  function takeDown(piece) {
    if (piece.type === 'floor' && standingOn(piece).length) return { message: 'Take down the walls and roof on this floor first.' };
    free(piece, piece.done ? piece.cost : piece.planks);
    unregister(piece);
    onSound?.('knock', 0.5);
    return { notify: piece.done ? `Took the ${PIECE[piece.type].name.toLowerCase()} apart` : 'Blueprint cleared' };
  }

  // Worn through by the sea: it breaks up, with whatever stood on it.
  let lastWarning = -Infinity;
  function breakUp(piece) {
    if (!pieces.includes(piece)) return;
    const on = piece.type === 'floor' ? standingOn(piece) : [];
    free(piece, piece.cost);
    unregister(piece);
    for (const other of on) breakUp(other);
    if (uniforms.uTime.value - lastWarning > 20) {
      lastWarning = uniforms.uTime.value;
      onMessage?.('The sea has broken up part of what you built. The planks are floating away.');
    }
  }

  let wearClock = 0;
  function wear(dt, sea) {
    if ((wearClock += dt) < 0.5) return;
    const step = wearClock;
    wearClock = 0;
    for (const piece of [...pieces]) {
      if (!piece.done) continue;
      piece.health -= sea.durabilityLoss(piece.center.x, piece.center.z, piece.low) * step;
      if (piece.health <= 0) breakUp(piece);
      else if (piece.shownHealth - piece.health > 0.04) dirty = true;
    }
  }

  const v = new THREE.Vector3();
  return {
    // The highest finished floor under (x, z) whose top is below maxY.
    floorAt(x, z, maxY) {
      const c = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      return c && c.floor.done && c.y <= maxY ? c.y : -Infinity;
    },

    // Keeps a body (feet at p, radius r, this tall) out of walls, and out
    // of floors higher than it can step onto.
    collide(p, r, height, step) {
      for (const piece of pieces) {
        if (!piece.done || piece.type === 'roof') continue;
        if ((piece.center.x - p.x) ** 2 + (piece.center.z - p.z) ** 2 > 16) continue;
        if (piece.deck) {
          const d = piece.deck;
          if (d.top > p.y + step && d.bottom < p.y + height) pushFromRect(p, r, d.x0, d.z0, d.x1, d.z1);
        } else {
          for (const s of piece.segments) if (p.y < s.y1 && p.y + height > s.y0) pushFromSegment(p, r, s);
        }
      }
    },

    // 1 under a finished roof, else 0.
    shelterAt(x, y, z) {
      const c = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      return c?.roof?.done && y < c.y + WALL_HEIGHT ? 1 : 0;
    },

    // Where a piece would go: { ok, reason, parts, ... }, or null when
    // there's nothing to build on under the crosshair. dir: the roof's way.
    plan(type, ray, dir) {
      if (type === 'floor') return planFloor(ray);
      if (type === 'roof') return planRoof(ray, dir);
      return planWall(type, ray);
    },

    // Shows a plan as a see-through preview: green if it fits, red if not.
    preview(plan) {
      preview.count = plan ? plan.parts.length : 0;
      if (!plan) return;
      plan.parts.forEach((part, i) => preview.setMatrixAt(i, part.matrix));
      preview.instanceMatrix.needsUpdate = true;
      previewMat.color.set(plan.ok ? '#9ff0ac' : '#ff8f7a');
    },

    place(plan) {
      if (!plan?.ok) return null;
      onSound?.('knock', 0.4);
      return place(plan);
    },

    // The piece under the crosshair, as { score, prompt, dim, act, hold }:
    // E adds a plank you're carrying, holding X takes it down.
    focus(ray, carrying) {
      let best = null, bestT = REACH;
      for (const piece of pieces) {
        if (piece.center.distanceToSquared(ray.origin) > 64 || !ray.intersectBox(piece.box, v)) continue;
        const t = v.distanceTo(ray.origin);
        if (t < bestT) {
          bestT = t;
          best = piece;
        }
      }
      if (!best) return null;
      const piece = best, name = PIECE[piece.type].name.toLowerCase();
      const score = 3 - bestT * 0.3;
      const hold = () => takeDown(piece);
      if (!piece.done) {
        const planks = carrying?.kind === 'plank';
        const need = piece.cost - piece.planks;
        return {
          score, key: piece, dim: !planks, hold,
          prompt: [
            ['E', planks ? `Add a plank to the ${name} (${piece.planks}/${piece.cost})` : `This ${name} needs ${need} more plank${need === 1 ? '' : 's'}`],
            ['X', 'Hold to clear the blueprint'],
          ],
          act: planks ? () => addPlank(piece) : null,
        };
      }
      const worn = piece.health < 0.97 ? `, ${Math.ceil(piece.health * 100)}% sound` : '';
      return { score, key: piece, dim: true, hold, prompt: [['X', `Hold to take the ${name} apart${worn}`]] };
    },

    update(dt, sea) {
      if (dt > 0) wear(dt, sea);
      if (dirty) {
        dirty = false;
        render();
      }
    },

    get count() { return { pieces: pieces.length, built: pieces.filter((p) => p.done).length }; },
  };
}
