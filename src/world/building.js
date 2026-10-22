import * as THREE from 'three';
import { uniforms, clamp } from '../shared.js';
import { boardGeometry, logGeometry } from './wood.js';

// Building with wood. Pieces snap to a 2 m grid: floors on posts or on log
// pilings (on land or out over the water), walls, windows, doorways,
// ladders and railings along a floor's edges, and pitched roofs over
// floors. A piece is placed as a blueprint, then built up a plank (or log)
// at a time, carried in your arms (see timber.js). Finished, its joints are
// made in the joinery mini-game (ui/joinery.js): the better they fit, the
// longer it lasts. Then it's solid: you stand on floors, climb ladders,
// walls and railings stop you and roofs give shade.
//
// Everything built wears down. Wood ages in any weather; rain soaks it and
// wet wood rots; storm winds batter roofs and anything high up; snow loads
// roofs; droughts crack it. The sea does the most damage: it floods what's
// built low, pounds it with surf and leaves a stained high-water mark. Worn
// boards grey and fall off; repairs with planks (or logs, for pilings) bring
// a piece back; left alone it gives way and its wood floats off.

export const CELL = 2;             // the building grid (m); a floor fills one cell
export const WALL_HEIGHT = 2.4;
const DOOR = { width: 0.95, height: 2 };
const WINDOW = { width: 0.8, sill: 1.2, top: 2 };
const RAIL = 1.05;                 // railing height (m)
const RISE = 0.95;                 // roof ridge above the walls (m)
const EAVE = 0.3;                  // roof overhang past the walls (m)
const DECK = 0.21;                 // a floor's joists and boards (m)
const MAX_POST = 5;                // longest post under a floor (m)
const MAX_PILING = 10;             // longest piling, from the seabed (m)
// Pilings: how high the deck stands above the water (or the ground), R to change.
export const DECK_LEVELS = [2, 3, 4, 5];
const REACH = 4;                   // from your eyes (m)
const MAX_SOLID = 6000, MAX_GHOST = 3000, MAX_LOGS = 400;
const HALF_PI = Math.PI / 2;
const CORNERS = [[0.12, 0.12], [1.88, 0.12], [0.12, 1.88], [1.88, 1.88]];
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // neighbouring cell across each side

// What can be built. cost: planks (or logs) to finish it.
export const PIECES = [
  { id: 'floor', name: 'Floor', cost: 6, hint: 'A plank deck on posts, or on pilings' },
  { id: 'wall', name: 'Wall', cost: 6, hint: 'Along the edge of a floor' },
  { id: 'doorway', name: 'Doorway', cost: 4, hint: 'A wall you can walk through' },
  { id: 'roof', name: 'Roof', cost: 8, hint: 'Over a floor: shade, and shelter from the rain (R turns it)' },
  { id: 'pilings', name: 'Pilings', cost: 4, material: 'log', hint: 'Log stilts in the ground or seabed, to build a floor on high above the sea' },
  { id: 'window', name: 'Window', cost: 5, hint: 'A wall with a window in it' },
  { id: 'ladder', name: 'Ladder', cost: 3, hint: 'Up the side of a raised floor' },
  { id: 'railing', name: 'Railing', cost: 3, hint: 'Along a floor edge, so you don’t fall off' },
];
const PIECE = Object.fromEntries(PIECES.map((p) => [p.id, p]));

// --- Wear, per second, as a fraction of a piece's condition.
const WEAR = {
  age: 0.00022,      // weathering in any weather (a little over an hour to nothing)
  rot: 0.0005,       // more while it's wet
  wind: 0.003,       // storm winds, by how exposed it is
  snow: 0.0007,      // snow load, on roofs
  heat: 0.00015,     // drying and cracking in a drought
  surf: 0.0011,      // waves on pilings, by how rough the sea is
};
// How much wind gets at each piece.
const EXPOSURE = { floor: 0.5, wall: 1, doorway: 1, window: 1.1, roof: 1.4, pilings: 0.3, ladder: 0.6, railing: 0.8 };
// Thick logs outlast planks.
const RESIST = { pilings: 5 };
// Condition back per plank (or log) used in a repair.
const REPAIR = { plank: 0.4, log: 0.5 };
// Ground each piece covers (m²), which stresses the land under it (see climate/entity.js).
const FOOTPRINT = { floor: CELL * CELL, pilings: 0.5, wall: 0.3, doorway: 0.3, window: 0.3, ladder: 0.2, railing: 0.2, roof: 0 };

// Joinery decides how well a piece holds together (q 0..1): from rough
// joints, which wear about as fast as unjoined ones, to masterful ones that
// last nearly twice as long.
const GRADES = [[0.45, 'Rough'], [0.75, 'Sound'], [0.92, 'Tight'], [Infinity, 'Masterful']];
export const jointName = (q) => (q == null ? 'Unjoined' : GRADES.find(([max]) => q < max)[1]);
const sturdiness = (piece) => (0.6 + 0.9 * (piece.joints ?? 0.3)) * (RESIST[piece.type] ?? 1);

const cellKey = (i, j) => `${i},${j}`;
// A cell's edge by side (0 north, 1 east, 2 south, 3 west), keyed so the
// two cells either side of it share it. (nx, nz) points out of cell (i, j).
function edgeOf(i, j, side) {
  const x0 = i * CELL, z0 = j * CELL, x1 = x0 + CELL, z1 = z0 + CELL;
  switch (side) {
    case 0: return { key: `x${i},${j}`, ax: x0, az: z0, bx: x1, bz: z0, nx: 0, nz: -1 };
    case 1: return { key: `z${i + 1},${j}`, ax: x1, az: z0, bx: x1, bz: z1, nx: 1, nz: 0 };
    case 2: return { key: `x${i},${j + 1}`, ax: x0, az: z1, bx: x1, bz: z1, nx: 0, nz: 1 };
    default: return { key: `z${i},${j}`, ax: x0, az: z0, bx: x0, bz: z1, nx: -1, nz: 0 };
  }
}

// --- The parts of each piece, each appearing at a step: how many planks
// (or logs) have gone in. Boards are scaled unit boxes with the grain along
// their local X. Frame parts (posts, joists, beams) stay put when worn
// boards fall off. Upright parts keep their ends, so the high-water mark
// can stain them part of the way up.
const e = new THREE.Euler(0, 0, 0, 'YXZ'), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
function board(parts, step, x, y, z, sx, sy, sz, yaw = 0, tilt = 0, roll = 0, frame = false) {
  e.set(tilt, yaw, roll);
  parts.push({ step, frame, matrix: new THREE.Matrix4().compose(pos.set(x, y, z), q.setFromEuler(e), scl.set(sx, sy, sz)) });
}
// An upright board (log: a log) from bottom to top.
function upright(parts, step, x, z, bottom, top, w, d, yaw, log = false) {
  const up = { x, z, bottom, top, w, d, yaw };
  parts.push({ step, frame: true, log, up, matrix: uprightMatrix(up, bottom, top, new THREE.Matrix4()) });
}
function uprightMatrix(up, bottom, top, m) {
  e.set(0, up.yaw, HALF_PI);
  return m.compose(pos.set(up.x, (bottom + top) / 2, up.z), q.setFromEuler(e), scl.set(top - bottom, up.w, up.d));
}

// A deck of six boards on two joists, on four posts down to the ground (or
// on pilings).
function floorParts(terrain, x0, z0, y, onPilings) {
  const parts = [];
  const joist = y - 0.14;
  if (!onPilings) {
    for (const [px, pz] of CORNERS) {
      const bottom = terrain.heightAt(x0 + px, z0 + pz) - 0.3, top = joist - 0.07;
      if (top - bottom > 0.05) upright(parts, 1, x0 + px, z0 + pz, bottom, top, 0.16, 0.16, 0);
    }
  }
  for (const px of [0.12, 1.88]) board(parts, 1, x0 + px, joist, z0 + 1, CELL, 0.14, 0.14, HALF_PI, 0, 0, true);
  for (let k = 0; k < 6; k++) board(parts, k + 1, x0 + 1, y - 0.035, z0 + (k + 0.5) / 3, CELL + 0.04, 0.07, 0.32);
  return parts;
}

// Four logs driven into the ground (or seabed) at the corners, up to `top`.
function pilingParts(terrain, x0, z0, top) {
  const parts = [];
  CORNERS.forEach(([px, pz], k) => upright(parts, k + 1, x0 + px, z0 + pz, terrain.heightAt(x0 + px, z0 + pz) - 0.8, top, 0.14, 0.14, k * 1.7, true));
  return parts;
}

// Six boards on edge between two corner posts. A doorway leaves a gap
// below the top board, a window one in the middle.
function wallParts({ ax, az, bx, bz }, y, type) {
  const parts = [];
  const cost = PIECE[type].cost;
  const ux = (bx - ax) / CELL, uz = (bz - az) / CELL;
  const yaw = Math.atan2(-uz, ux);
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  // Posts just inside the ends, so walls meeting at a corner don't share one.
  const post = uz === 0 ? 0.14 : 0.15;
  for (const k of [0.07, CELL - 0.07]) upright(parts, 1, ax + ux * k, az + uz * k, y, y + WALL_HEIGHT + (uz === 0 ? 0 : 0.01), post, post, yaw);
  const gap = type === 'doorway' ? { from: 0, to: DOOR.height, width: DOOR.width }
    : type === 'window' ? { from: WINDOW.sill, to: WINDOW.top, width: WINDOW.width } : null;
  if (gap) {
    // A frame round the opening, and a sill under a window.
    for (const sgn of [-1, 1]) {
      const k = sgn * (gap.width / 2 + 0.05);
      upright(parts, 1, mx + ux * k, mz + uz * k, y + gap.from, y + gap.to, 0.1, 0.1, yaw);
    }
    if (type === 'window') board(parts, 1, mx, y + gap.from, mz, gap.width + 0.2, 0.05, 0.14, yaw, 0, 0, true);
  }
  const rows = 6, rowH = WALL_HEIGHT / rows, side = gap ? (CELL - gap.width) / 2 : 0;
  for (let r = 0; r < rows; r++) {
    const cy = y + (r + 0.5) * rowH;
    const step = Math.floor((r * cost) / rows) + 1;
    if (gap && cy > y + gap.from && cy < y + gap.to) {
      for (const sgn of [-1, 1]) {
        const k = sgn * (CELL - side) / 2;
        board(parts, step, mx + ux * k, cy, mz + uz * k, side, rowH - 0.02, 0.07, yaw);
      }
    } else {
      board(parts, step, mx, cy, mz, CELL, rowH - 0.02, 0.07, yaw);
    }
  }
  return parts;
}

// Two rails and rungs every 30 cm, hanging off the edge of a floor at `top`
// down to the ground or the seabed, with handholds above the deck.
function ladderParts(terrain, { ax, az, bx, bz, nx, nz }, top) {
  const parts = [];
  const ux = (bx - ax) / CELL, uz = (bz - az) / CELL, yaw = Math.atan2(-uz, ux);
  const cx = (ax + bx) / 2 + nx * 0.12, cz = (az + bz) / 2 + nz * 0.12;
  const bottom = terrain.heightAt(cx, cz) - 0.1;
  for (const s of [-0.28, 0.28]) upright(parts, 1, cx + ux * s, cz + uz * s, bottom, top + 0.75, 0.06, 0.05, yaw);
  const rungs = Math.max(1, Math.floor((top - bottom - 0.15) / 0.3));
  for (let r = 0; r < rungs; r++) board(parts, 1 + Math.floor((r / rungs) * 3), cx, bottom + 0.3 * (r + 1), cz, 0.6, 0.045, 0.045, yaw);
  return parts;
}

// Three posts, a middle rail and a handrail along a floor edge.
function railingParts({ ax, az, bx, bz }, y) {
  const parts = [];
  const ux = (bx - ax) / CELL, uz = (bz - az) / CELL, yaw = Math.atan2(-uz, ux);
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  for (const k of [0.05, CELL / 2, CELL - 0.05]) upright(parts, 1, ax + ux * k, az + uz * k, y, y + RAIL, 0.08, 0.08, yaw);
  board(parts, 2, mx, y + 0.5, mz, CELL, 0.07, 0.045, yaw);
  board(parts, 3, mx, y + RAIL - 0.04, mz, CELL + 0.06, 0.07, 0.09, yaw);
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
  const add = (step, lx, ly, lz, sx, sy, sz, tilt = 0, roll = 0, frame = false) =>
    board(parts, step, dir ? cx + lz : cx + lx, ly, dir ? cz - lx : cz + lz, sx, sy, sz, yaw, tilt, roll, frame);
  add(1, 0, y + RISE - 0.08, 0, CELL + 0.1, 0.12, 0.12, 0, 0, true);
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
  add(8, 0, y + RISE + 0.07, 0, CELL + 0.24, 0.08, 0.22, 0, 0, true);
  return parts;
}

// Half-extent of a transformed unit box: half the absolute columns, summed.
const halfY = (el) => (Math.abs(el[1]) + Math.abs(el[5]) + Math.abs(el[9])) / 2;

// Bounds of a list of parts, for aiming at them.
function bounds(parts, box = new THREE.Box3()) {
  box.makeEmpty();
  const c = new THREE.Vector3(), h = new THREE.Vector3();
  for (const { matrix } of parts) {
    const el = matrix.elements;
    c.set(el[12], el[13], el[14]);
    h.set((Math.abs(el[0]) + Math.abs(el[4]) + Math.abs(el[8])) / 2, halfY(el), (Math.abs(el[2]) + Math.abs(el[6]) + Math.abs(el[10])) / 2);
    box.expandByPoint(c.clone().sub(h));
    box.expandByPoint(c.add(h));
  }
  return box;
}

// Pushes a circle (the player) out of a wall segment...
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

// ...out of a piling...
function pushFromPost(p, r, c) {
  const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = r + c.r;
  if (d >= min || d < 1e-5) return;
  p.x = c.x + (dx / d) * min;
  p.z = c.z + (dz / d) * min;
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

// takeWood(kind): uses up a plank or log you're carrying and returns it (null if you have none).
// release([{ x, y, z, yaw, kind, bark }]): planks and logs back into the world.
// onMessage(text), onSound(name, strength), onChange(): something was
// built or taken down (things lying on it may need to fall).
// onImpact({ kind: 'build', x, z, area }): ground built over, in m²
// (negative when a piece comes down), for the climate (climate/entity.js).
export function createBuilding(scene, { terrain, colliders, wood, rng, shadows, takeWood, release, onMessage, onSound, onChange, onImpact }) {
  // Grid cells with a floor and/or pilings: { i, j, x0, z0, y (deck top), floor, roof, pilings, top (of the pilings) }.
  const cells = new Map();
  const edges = new Map();   // walls, windows, doorways, ladders and railings by edge key
  const pieces = [];
  let dirty = true;

  // --- Drawing: built boards and logs, blueprints still to fill, and the placement preview.
  const boardGeo = boardGeometry(), logGeo = logGeometry();
  const solid = new THREE.InstancedMesh(boardGeo, wood.plank, MAX_SOLID);
  solid.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SOLID * 3), 3);
  const ghost = new THREE.InstancedMesh(boardGeo, wood.ghost, MAX_GHOST);
  const ghostLogs = new THREE.InstancedMesh(logGeo, wood.ghost, MAX_LOGS);
  const previewMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, fog: false });
  const preview = new THREE.InstancedMesh(boardGeo, previewMat, 64);
  const previewLogs = new THREE.InstancedMesh(logGeo, previewMat, 8);
  for (const mesh of [solid, ghost, ghostLogs, preview, previewLogs]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  solid.castShadow = shadows;
  solid.receiveShadow = true;
  ghost.renderOrder = ghostLogs.renderOrder = preview.renderOrder = previewLogs.renderOrder = 2;
  // Built logs, one mesh per kind of bark, made when first needed.
  const logs = {};
  function logMesh(bark) {
    if (!logs[bark]) {
      const mesh = new THREE.InstancedMesh(logGeo, [wood.bark[bark], wood.endGrain, wood.endGrain], MAX_LOGS);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LOGS * 3), 3);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      scene.add(mesh);
      logs[bark] = { mesh, n: 0 };
    }
    return logs[bark];
  }

  // Wood greys and darkens as it wears and darkens when wet. Below the
  // high-water mark it's stained and green with weed, with a crust of salt
  // along the mark itself.
  const CLEAN = 0, STAINED = 1, SALT = 2;
  const color = new THREE.Color(), grey = new THREE.Color(), m = new THREE.Matrix4();
  const weed = new THREE.Color(0.3, 0.42, 0.26), salt = new THREE.Color(0.95, 0.93, 0.86);
  function tint(piece, part, mark) {
    const worn = 1 - piece.health, t = part.log ? 1 : part.tone;
    color.setRGB(t, t * 0.97, t * 0.92).lerp(grey.setScalar(t * 0.8), 0.8 * worn);
    if (mark === SALT) return color.lerp(salt, 0.7);
    if (mark === STAINED) color.lerp(grey.copy(weed).multiplyScalar(t), 0.7);
    return color.multiplyScalar((1 - 0.32 * worn) * (1 - 0.25 * piece.wet));
  }
  let s = 0;
  function draw(piece, part, matrix, mark) {
    tint(piece, part, mark);
    if (part.log) {
      const l = logMesh(piece.barks[part.step - 1] ?? 'oak');
      if (l.n >= MAX_LOGS) return;
      l.mesh.setMatrixAt(l.n, matrix);
      l.mesh.setColorAt(l.n++, color);
    } else if (s < MAX_SOLID) {
      solid.setMatrixAt(s, matrix);
      solid.setColorAt(s++, color);
    }
  }
  function render() {
    s = 0;
    let g = 0, gl = 0;
    for (const l of Object.values(logs)) l.n = 0;
    for (const piece of pieces) {
      piece.shown = { health: piece.health, wet: piece.wet, flood: piece.floodMark };
      const mark = piece.floodMark;
      for (const part of piece.parts) {
        if (!piece.done && part.step > piece.added) {
          if (part.log) { if (gl < MAX_LOGS) ghostLogs.setMatrixAt(gl++, part.matrix); }
          else if (g < MAX_GHOST) ghost.setMatrixAt(g++, part.matrix);
          continue;
        }
        if (piece.done && piece.health < part.breakAt) continue;   // worn through: fallen off
        const { up } = part;
        if (up && mark > up.bottom + 0.15 && mark < up.top - 0.02) {
          // Stained up to the high-water mark, salt along it, clean above.
          draw(piece, part, uprightMatrix(up, up.bottom, mark - 0.1, m), STAINED);
          draw(piece, part, uprightMatrix(up, mark - 0.1, mark, m), SALT);
          draw(piece, part, uprightMatrix(up, mark, up.top, m), CLEAN);
        } else {
          draw(piece, part, part.matrix, mark > part.middle ? STAINED : CLEAN);
        }
      }
    }
    solid.count = s;
    ghost.count = g;
    ghostLogs.count = gl;
    solid.instanceMatrix.needsUpdate = true;
    solid.instanceColor.needsUpdate = true;
    ghost.instanceMatrix.needsUpdate = true;
    ghostLogs.instanceMatrix.needsUpdate = true;
    for (const { mesh, n } of Object.values(logs)) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
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
      if (!c.floor) continue;
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
  // Trunks, stumps and boulders in the way of a floor or pilings.
  const found = [];
  function blocked(x0, z0) {
    return colliders.query(x0 + CELL / 2, z0 + CELL / 2, found).some((c) => {
      const dx = Math.max(x0 - c.x, 0, c.x - x0 - CELL), dz = Math.max(z0 - c.z, 0, c.z - z0 - CELL);
      return dx * dx + dz * dz < c.r * c.r;
    });
  }
  // Highest and lowest ground under a cell.
  function groundUnder(x0, z0) {
    let high = -Infinity, low = Infinity;
    for (const [px, pz] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
      const h = terrain.heightAt(x0 + px * CELL, z0 + pz * CELL);
      high = Math.max(high, h);
      low = Math.min(low, h);
    }
    return { high, low };
  }

  function planFloor(ray) {
    if (!groundHit(ray, 9)) return null;
    let i = Math.floor(hit.x / CELL), j = Math.floor(hit.z / CELL);
    // Aiming at a floor that's already there: the next cell along, the way you're looking.
    if (cells.get(cellKey(i, j))?.floor) {
      const d = ray.direction;
      if (Math.abs(d.x) > Math.abs(d.z)) i += Math.sign(d.x);
      else j += Math.sign(d.z);
    }
    const x0 = i * CELL, z0 = j * CELL;
    const cell = cells.get(cellKey(i, j));
    if (cell?.floor) return { type: 'floor', i, j, x0, z0, y: cell.y, parts: floorParts(terrain, x0, z0, cell.y, !!cell.pilings), reason: 'There’s a floor here already' };
    // On pilings, the deck sits on top of them.
    if (cell?.pilings) {
      const y = cell.top + DECK;
      return { type: 'floor', i, j, x0, z0, y, parts: floorParts(terrain, x0, z0, y, true), ok: true };
    }
    const { high, low } = groundUnder(x0, z0);
    let y = Math.max(high, uniforms.uWaterLevel.value + 0.4) + 0.25;
    // Level with a floor next to it, if that's close and clears the ground.
    let nearest = Infinity;
    for (const [di, dj] of SIDES) {
      const n = cells.get(cellKey(i + di, j + dj));
      const gap = n?.floor ? Math.abs(n.y - y) : Infinity;
      if (gap < 1.3 && gap < nearest && n.y > high + 0.1) {
        nearest = gap;
        y = n.y;
      }
    }
    const plan = { type: 'floor', i, j, x0, z0, y, parts: floorParts(terrain, x0, z0, y, false) };
    if (y - low > MAX_POST) return { ...plan, reason: 'Too high off the ground here: build pilings first' };
    if (blocked(x0, z0)) return { ...plan, reason: 'Something’s in the way' };
    return { ...plan, ok: true };
  }

  function planPilings(ray, turn) {
    if (!groundHit(ray, 12)) return null;
    const i = Math.floor(hit.x / CELL), j = Math.floor(hit.z / CELL), x0 = i * CELL, z0 = j * CELL;
    const { high, low } = groundUnder(x0, z0);
    let top = Math.max(high, uniforms.uWaterLevel.value) + DECK_LEVELS[turn % DECK_LEVELS.length];
    // Level with pilings or a floor next to it, so the decks line up.
    let nearest = Infinity;
    for (const [di, dj] of SIDES) {
      const n = cells.get(cellKey(i + di, j + dj));
      const t = n?.pilings ? n.top : n?.floor ? n.y - DECK : null;
      if (t !== null && Math.abs(t - top) < 1 && Math.abs(t - top) < nearest && t > high + 0.5) {
        nearest = Math.abs(t - top);
        top = t;
      }
    }
    const plan = { type: 'pilings', i, j, x0, z0, top, low, parts: pilingParts(terrain, x0, z0, top) };
    if (cells.has(cellKey(i, j))) return { ...plan, reason: 'Something’s built here already' };
    if (top - low > MAX_PILING) return { ...plan, reason: 'Too deep here' };
    if (blocked(x0, z0)) return { ...plan, reason: 'Something’s in the way' };
    return { ...plan, ok: true };
  }

  // Walls, windows, doorways, ladders and railings: on the floor edge nearest the crosshair.
  function planEdge(type, ray) {
    const h = floorHit(ray, false);
    if (!h) return null;
    const c = h.cell;
    const fx = h.x - c.x0, fz = h.z - c.z0;
    const near = [fz, CELL - fx, CELL - fz, fx];
    const side = near.indexOf(Math.min(...near));
    const edge = edgeOf(c.i, c.j, side);
    const parts = type === 'ladder' ? ladderParts(terrain, edge, c.y) : type === 'railing' ? railingParts(edge, c.y) : wallParts(edge, c.y, type);
    const plan = { type, cell: c, edge, y: c.y, parts };
    if (edges.has(edge.key)) return { ...plan, reason: 'Something’s on this edge already' };
    if (type === 'ladder') {
      const other = cells.get(cellKey(c.i + SIDES[side][0], c.j + SIDES[side][1]));
      if (other?.floor && Math.abs(other.y - c.y) < 1.5) return { ...plan, reason: 'There’s a floor on the other side' };
    }
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
    const def = PIECE[plan.type];
    const piece = {
      type: plan.type, name: def.name.toLowerCase(), cost: def.cost, material: def.material ?? 'plank',
      added: 0, barks: [], done: false, health: 1, joints: null, wet: 0, floodMark: -Infinity, water: null,
      parts: plan.parts.map((part) => ({
        ...part, tone: 0.86 + rng() * 0.24, breakAt: part.frame ? 0 : rng() * 0.45, middle: part.matrix.elements[13],
      })),
      box: bounds(plan.parts),
    };
    // What you aim at: a floor's deck (not the posts under it), each of
    // the pilings (not the space between them, where a floor goes on top),
    // or the whole piece.
    piece.aim = plan.type === 'floor'
      ? [new THREE.Box3(new THREE.Vector3(plan.x0, plan.y - 0.3, plan.z0), new THREE.Vector3(plan.x0 + CELL, plan.y, plan.z0 + CELL))]
      : plan.type === 'pilings' ? piece.parts.map((part) => bounds([part])) : [piece.box];
    if (plan.type === 'floor' || plan.type === 'pilings') {
      const key = cellKey(plan.i, plan.j);
      const cell = cells.get(key) ?? { i: plan.i, j: plan.j, x0: plan.x0, z0: plan.z0, floor: null, roof: null, pilings: null };
      cells.set(key, cell);
      piece.cell = cell;
      if (plan.type === 'floor') {
        cell.floor = piece;
        cell.y = plan.y;
        piece.low = plan.y - DECK;   // the underside of the deck (posts and pilings are meant to stand in water)
      } else {
        cell.pilings = piece;
        cell.top = plan.top;
        piece.top = plan.top;
        piece.low = plan.low;        // the ground or seabed they stand in
      }
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
      piece.deck = { x0: cell.x0, z0: cell.z0, x1: cell.x0 + CELL, z1: cell.z0 + CELL, top: cell.y, bottom: cell.y - DECK };
    } else if (piece.type === 'pilings') {
      piece.posts = piece.parts.map(({ up }) => ({ x: up.x, z: up.z, r: up.w, y0: up.bottom, y1: up.top }));
    } else if (piece.edge) {
      const { ax, az, bx, bz, nx, nz } = piece.edge, y = piece.low;
      const ux = (bx - ax) / CELL, uz = (bz - az) / CELL;
      if (piece.type === 'ladder') {
        const ex = (ax + bx) / 2, ez = (az + bz) / 2;
        piece.ladder = { ex, ez, ux, uz, nx, nz, top: y, bottom: terrain.heightAt(ex + nx * 0.12, ez + nz * 0.12) - 0.1 };
      } else if (piece.type === 'railing') {
        piece.segments = [{ ax, az, bx, bz, y0: y, y1: y + RAIL }];
      } else if (piece.type === 'doorway') {
        // Either side of the opening, and the lintel over it.
        const side = (CELL - DOOR.width) / 2;
        piece.segments = [
          { ax, az, bx: ax + ux * side, bz: az + uz * side, y0: y, y1: y + WALL_HEIGHT },
          { ax: bx - ux * side, az: bz - uz * side, bx, bz, y0: y, y1: y + WALL_HEIGHT },
          { ax, az, bx, bz, y0: y + DOOR.height, y1: y + WALL_HEIGHT },
        ];
      } else {
        piece.segments = [{ ax, az, bx, bz, y0: y, y1: y + WALL_HEIGHT }];
      }
    }
    onImpact?.({ kind: 'build', x: piece.center.x, z: piece.center.z, area: FOOTPRINT[piece.type] });
    onChange?.();
  }

  // The joinery mini-game for a piece: apply(q) keeps the better joints.
  function joineryFor(piece) {
    return {
      name: piece.name,
      apply(quality) {
        if (!pieces.includes(piece)) return null;
        const before = piece.joints;
        if (before != null && quality <= before) return `Your old ${jointName(before).toLowerCase()} joints were better: you kept them`;
        piece.joints = quality;
        return `${jointName(quality)} joints on the ${piece.name}`;
      },
    };
  }

  function addWood(piece) {
    const w = takeWood(piece.material);
    if (!w) return { message: piece.material === 'log' ? 'You need logs: fell a tree and carry them here.' : 'You need planks: split logs with an axe and carry them here.' };
    piece.added++;
    if (w.bark) piece.barks.push(w.bark);
    dirty = true;
    onSound?.('knock', 0.8);
    if (piece.added < piece.cost) return {};
    complete(piece);
    return { notify: `Built a ${piece.name}`, joinery: joineryFor(piece) };
  }

  function repair(piece) {
    const w = takeWood(piece.material);
    if (!w) return null;
    if (w.bark) piece.barks.push(w.bark);
    piece.health = Math.min(1, piece.health + REPAIR[piece.material]);
    if (piece.health > 0.5) piece.warnedLow = false;
    dirty = true;
    onSound?.('knock', 0.8);
    return { notify: `Repaired the ${piece.name}: ${Math.round(piece.health * 100)}%` };
  }

  // What stands on a piece: on a floor, the walls (and so on) along its
  // edges that no other floor holds up, and its roof; on pilings, the floor.
  function standingOn(piece) {
    if (piece.type === 'pilings') return piece.cell.floor ? [piece.cell.floor] : [];
    if (piece.type !== 'floor') return [];
    const { i, j } = piece.cell;
    const on = [];
    SIDES.forEach(([di, dj], side) => {
      const other = edges.get(edgeOf(i, j, side).key);
      if (other && !cells.get(cellKey(i + di, j + dj))?.floor) on.push(other);
    });
    if (piece.cell.roof) on.push(piece.cell.roof);
    return on;
  }

  function unregister(piece) {
    pieces.splice(pieces.indexOf(piece), 1);
    const { cell } = piece;
    if (piece.type === 'floor' || piece.type === 'pilings') {
      if (piece.type === 'floor') cell.floor = null;
      else cell.pilings = null;
      if (!cell.floor && !cell.pilings) cells.delete(cellKey(cell.i, cell.j));
    } else if (piece.type === 'roof') {
      cell.roof = null;
    } else {
      edges.delete(piece.edge.key);
    }
    if (piece.done) onImpact?.({ kind: 'build', x: piece.center.x, z: piece.center.z, area: -FOOTPRINT[piece.type] });
    dirty = true;
    onChange?.();
  }

  // The wood in a piece comes back into the world, where its parts were.
  function free(piece, count) {
    const list = [];
    for (let k = 0; k < count; k++) {
      const el = piece.parts[Math.floor((k * piece.parts.length) / count)].matrix.elements;
      list.push({
        x: el[12] + (rng() - 0.5) * 0.4, y: el[13] + 0.2, z: el[14] + (rng() - 0.5) * 0.4, yaw: rng() * Math.PI,
        kind: piece.material, bark: piece.barks[k] ?? 'oak',
      });
    }
    release(list);
  }

  // Hold X: take a piece apart (or clear a blueprint), getting the wood back.
  function takeDown(piece) {
    if (standingOn(piece).length) {
      return { message: piece.type === 'pilings' ? 'Take the floor off these pilings first.' : 'Take down the walls and roof on this floor first.' };
    }
    free(piece, piece.done ? piece.cost : piece.added);
    unregister(piece);
    onSound?.('knock', 0.5);
    return { notify: piece.done ? `Took the ${piece.name} apart` : 'Blueprint cleared' };
  }

  let lastWarning = -Infinity;
  function warn(text) {
    if (uniforms.uTime.value - lastWarning < 12) return;
    lastWarning = uniforms.uTime.value;
    onMessage?.(text);
  }

  // Worn through: it gives way, with whatever stood on it.
  function breakUp(piece) {
    if (!pieces.includes(piece)) return;
    const on = standingOn(piece);
    free(piece, piece.cost);
    unregister(piece);
    for (const other of on) breakUp(other);
    const afloat = piece.water > piece.low;
    warn(`Your ${piece.name} has given way. Its ${piece.material}s are ${afloat ? 'floating away' : 'lying where it stood'}.`);
  }

  // Weather and sea at work on everything built, twice a second.
  const surf = {};
  let wearClock = 0;
  function wear(dt, sea, weather) {
    if ((wearClock += dt) < 0.5) return;
    const step = wearClock;
    wearClock = 0;
    const t = uniforms.uTime.value;
    const gust = Math.max(0, weather.gustWind - 0.45) ** 1.3;
    const rough = 1 + 0.5 * sea.water.waves.hs;
    for (const piece of [...pieces]) {
      if (!piece.done || !pieces.includes(piece)) continue;
      const { x, z } = piece.center;
      const water = (piece.water = sea.water.surface(x, z, t, surf).height);
      if (water > piece.floodMark + 0.03) piece.floodMark = water;
      const flooded = water > piece.low;
      // Rain soaks it (unless a roof is over it), and so does the sea; sun and drought dry it.
      const sheltered = piece.type !== 'roof' && piece.cell.roof?.done;
      const soak = flooded ? 1 : sheltered ? 0 : Math.min(1, weather.current.rain * 1.4);
      piece.wet += (soak - piece.wet) * (1 - Math.exp(-step / (soak > piece.wet ? 30 : 200 / (1 + 2 * weather.dryness))));
      // The higher it stands, the harder the wind gets at it.
      const height = clamp(piece.low - Math.max(terrain.heightAt(x, z), sea.level), 0, 8);
      let loss = WEAR.age + WEAR.rot * piece.wet + WEAR.heat * weather.dryness
        + WEAR.wind * gust * EXPOSURE[piece.type] * (1 + 0.12 * height)
        + (piece.type === 'roof' ? WEAR.snow * weather.snowCover : 0);
      // The sea: pilings are meant to stand in it, so only the surf works on them.
      loss += piece.type === 'pilings' && flooded ? WEAR.surf * rough : sea.durabilityLoss(x, z, piece.low, t);
      piece.health -= (loss / sturdiness(piece)) * step;
      if (piece.health <= 0) {
        breakUp(piece);
        continue;
      }
      if (piece.health < 0.35 && !piece.warnedLow) {
        piece.warnedLow = true;
        warn(`Your ${piece.name} is down to ${Math.round(piece.health * 100)}%. Bring ${piece.material}s to repair it before it gives way.`);
      }
      // The sea creeping up on it (pilings are meant to stand in it).
      if (piece.type !== 'pilings' && piece.type !== 'ladder') {
        const margin = piece.low - water;
        if (margin < 0.4 && !piece.warnedSea) {
          piece.warnedSea = true;
          warn(margin < 0 ? `The sea has reached your ${piece.name}.` : `The sea is nearly up to your ${piece.name}.`);
        } else if (margin > 1) {
          piece.warnedSea = false;
        }
      }
      const shown = piece.shown;
      if (!shown || shown.health - piece.health > 0.02 || Math.abs(shown.wet - piece.wet) > 0.08 || piece.floodMark - shown.flood > 0.05) dirty = true;
    }
  }

  // What you see when you look at a piece: its condition, joints, wetness
  // and how high it stands above the water.
  function describe(piece) {
    const bits = [`${PIECE[piece.type].name} ${Math.ceil(piece.health * 100)}%`, `${jointName(piece.joints).toLowerCase()} joints`];
    if (piece.wet > 0.5) bits.push('soaked');
    const water = piece.water ?? uniforms.uWaterLevel.value;
    if (piece.type === 'pilings') bits.push(`top ${(piece.top - water).toFixed(1)} m above the water`);
    else if (piece.type !== 'ladder') bits.push(piece.low < water ? 'under water' : `${(piece.low - water).toFixed(1)} m above the water`);
    return bits.join(' · ');
  }

  const v = new THREE.Vector3();
  return {
    // The highest finished floor under (x, z) whose top is below maxY.
    floorAt(x, z, maxY) {
      const c = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      return c?.floor?.done && c.y <= maxY ? c.y : -Infinity;
    },

    // Keeps a body (feet at p, radius r, this tall) out of walls, railings
    // and pilings, and out of floors higher than it can step onto.
    collide(p, r, height, step) {
      for (const piece of pieces) {
        if (!piece.done || piece.type === 'roof' || piece.type === 'ladder') continue;
        if ((piece.center.x - p.x) ** 2 + (piece.center.z - p.z) ** 2 > 16) continue;
        if (piece.deck) {
          const d = piece.deck;
          if (d.top > p.y + step && d.bottom < p.y + height) pushFromRect(p, r, d.x0, d.z0, d.x1, d.z1);
        } else if (piece.posts) {
          for (const c of piece.posts) if (p.y < c.y1 && p.y + height > c.y0) pushFromPost(p, r, c);
        } else {
          for (const seg of piece.segments) if (p.y < seg.y1 && p.y + height > seg.y0) pushFromSegment(p, r, seg);
        }
      }
    },

    // The finished ladder you're on (just off the edge of its floor, between
    // its foot and the deck), if any: { top, bottom, ... }.
    ladderAt(x, y, z) {
      for (const piece of pieces) {
        const l = piece.done && piece.ladder;
        if (!l) continue;
        const dx = x - l.ex, dz = z - l.ez;
        const along = dx * l.ux + dz * l.uz, out = dx * l.nx + dz * l.nz;
        if (Math.abs(along) < 0.5 && out > -0.05 && out < 0.8 && y > l.bottom - 0.3 && y < l.top + 0.15) return l;
      }
      return null;
    },

    // 1 under a finished roof, else 0.
    shelterAt(x, y, z) {
      const c = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      return c?.roof?.done && y < c.y + WALL_HEIGHT ? 1 : 0;
    },

    // Where a piece would go: { ok, reason, parts, ... }, or null when
    // there's nothing to build on under the crosshair. turn (R) turns a
    // roof or raises pilings.
    plan(type, ray, turn = 0) {
      if (type === 'floor') return planFloor(ray);
      if (type === 'pilings') return planPilings(ray, turn);
      if (type === 'roof') return planRoof(ray, turn % 2);
      return planEdge(type, ray);
    },

    // Shows a plan as a see-through preview: green if it fits, red if not.
    preview(plan) {
      let b = 0, l = 0;
      for (const part of plan?.parts ?? []) {
        if (part.log) previewLogs.setMatrixAt(l++, part.matrix);
        else preview.setMatrixAt(b++, part.matrix);
      }
      preview.count = b;
      previewLogs.count = l;
      preview.instanceMatrix.needsUpdate = true;
      previewLogs.instanceMatrix.needsUpdate = true;
      if (plan) previewMat.color.set(plan.ok ? '#9ff0ac' : '#ff8f7a');
    },

    place(plan) {
      if (!plan?.ok) return null;
      onSound?.('knock', 0.4);
      return place(plan);
    },

    // The piece under the crosshair, as { score, prompt, dim, act, hold }.
    // E adds the plank (or log) you're carrying to a blueprint, repairs a
    // worn piece with it, or with empty arms reworks the joints; holding X
    // takes the piece down.
    focus(ray, carrying) {
      let best = null, bestT = REACH;
      for (const piece of pieces) {
        if (piece.center.distanceToSquared(ray.origin) > 100) continue;
        for (const box of piece.aim) {
          if (!ray.intersectBox(box, v)) continue;
          const t = v.distanceTo(ray.origin);
          if (t < bestT) {
            bestT = t;
            best = piece;
          }
        }
      }
      if (!best) return null;
      const piece = best, wood = piece.material;
      const score = 3 - bestT * 0.3;
      const hold = () => takeDown(piece);
      const has = carrying?.kind === wood;
      if (!piece.done) {
        const need = piece.cost - piece.added;
        return {
          score, key: piece, dim: !has, hold,
          prompt: [
            ['E', has ? `Add a ${wood} to the ${piece.name} (${piece.added}/${piece.cost})` : `This ${piece.name} needs ${need} more ${wood}${need === 1 ? '' : 's'}`],
            ['X', 'Hold to clear the blueprint'],
          ],
          act: has ? () => addWood(piece) : null,
        };
      }
      const prompt = [];
      let act = null;
      if (has && piece.health < 0.97) {
        prompt.push(['E', `Repair with a ${wood} (+${Math.round(REPAIR[wood] * 100)}%)`]);
        act = () => repair(piece);
      } else if (!carrying) {
        prompt.push(['E', piece.joints == null ? 'Join the frame' : 'Rework the joints']);
        act = () => ({ joinery: joineryFor(piece) });
      }
      prompt.push(['X', 'Hold to take apart'], [null, describe(piece)]);
      return { score, key: piece, dim: !act, hold, act, prompt };
    },

    // How many finished pieces need repairs (under half), and the worst.
    status() {
      let worn = 0, lowest = 1;
      for (const piece of pieces) {
        if (!piece.done) continue;
        if (piece.health < 0.5) worn++;
        lowest = Math.min(lowest, piece.health);
      }
      return { worn, lowest };
    },

    // What's built, seen from above (for the map): floors and pilings by
    // their cell's corner (x, z), walls and the like by the edge they stand
    // on, each with whether it's finished or still a blueprint. size: a
    // cell's width (m).
    layout() {
      const cells = [], edges = [];
      for (const p of pieces) {
        if (p.type === 'floor' || p.type === 'pilings') cells.push({ x: p.cell.x0, z: p.cell.z0, type: p.type, done: p.done });
        else if (p.edge) edges.push({ ax: p.edge.ax, az: p.edge.az, bx: p.edge.bx, bz: p.edge.bz, done: p.done });
      }
      return { cells, edges, size: CELL };
    },

    update(dt, sea, weather) {
      if (dt > 0) wear(dt, sea, weather);
      if (dirty) {
        dirty = false;
        render();
      }
    },

    get count() { return { pieces: pieces.length, built: pieces.filter((p) => p.done).length }; },
  };
}
