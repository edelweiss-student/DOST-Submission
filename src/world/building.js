import * as THREE from 'three';
import { uniforms, clamp } from '../shared.js';
import { MAX_STAIRS, PIECE_HP, damageOf } from '../match/rules.js';
import { boardGeometry, logGeometry } from './wood.js';

// Building with wood. Pieces snap to a 2 m grid: floors on posts or on log
// pilings (on land or out over the water), walls, windows, doors (each in
// its own doorway), railings and stairs along a floor's edges, and pitched
// roofs over floors.
// A door swings open into its floor and shut again (E); in a match only
// its own team can open it, and anyone else has to break it down.
// Every piece turns (R, the `turn` of a plan): a floor's boards, a roof's
// ridge and the braces between pilings go either way, and the pieces on
// an edge go round their floor a side at a time; pilings also stand at one
// of DECK_LEVELS (`raise`, Z). A piece is placed as a blueprint, then built
// up a plank (or log) at a time, carried in your arms (see timber.js).
// Finished, its joints are made in the joinery mini-game (ui/joinery.js):
// the better they fit, the longer it lasts. Then it's solid: you stand on
// floors, walk up stairs, walls and railings stop you and roofs give
// shade. Everyone can build MAX_STAIRS stairs at most.
//
// In a multiplayer match each team also puts up a bahay kubo (buildKubo):
// the house on stilts of the Philippines, 2 × 2 cells, built all at once
// out of the same pieces in bamboo, woven bamboo (sawali) and nipa thatch
// (materials in kubo.js), with its own steps up to the door.
//
// Everything built wears down. Wood ages in any weather; rain soaks it and
// wet wood rots; storm winds batter roofs and anything high up; snow loads
// roofs; droughts crack it. The sea does the most damage: it floods what's
// built low, pounds it with surf and leaves a stained high-water mark. Worn
// boards grey and fall off; repairs with planks (or logs, for pilings) bring
// a piece back; left alone it gives way and its wood floats off. Tools
// break things too: each blow costs a finished piece some of its condition
// (DAMAGE in match/rules.js), and at nothing it falls, with whatever stood
// on it, leaving half its wood.
//
// In a multiplayer match what's built is shared (share()): every change
// goes to the other players' games, which apply() it, and pieces belong to
// a team. Another team's pieces can't be built on or taken apart, only
// broken with tools (blows go through the server: match/bedwars.js), and
// nothing weathers, so every game agrees on what stands.

export const CELL = 2;             // the building grid (m); a floor fills one cell
export const WALL_HEIGHT = 2.4;
const DOOR = { width: 0.95, height: 2, open: 1.7, time: 0.35 };   // open: how far it swings (radians), in `time` seconds
const WINDOW = { width: 0.8, sill: 1.2, top: 2 };
const RAIL = 1.05;                 // railing height (m)
const RISE = 0.95;                 // roof ridge above the walls (m)
const EAVE = 0.3;                  // roof overhang past the walls (m)
export const DECK = 0.21;          // a floor's joists and boards (m)
const MAX_POST = 5;                // longest post under a floor (m)
const MAX_PILING = 10;             // longest piling, from the seabed (m)
// Pilings: how high the deck stands above the water (or the ground), Z to change.
export const DECK_LEVELS = [2, 3, 4, 5];
const REACH = 4;                   // from your eyes (m)
const MAX_SOLID = 6000, MAX_GHOST = 3000, MAX_LOGS = 400, MAX_SKIN = 2000;
// Stairs: about 40° from a floor's edge down to the ground (or the seabed),
// a step every 22 cm or so, 1 m wide. Lower than `min`, step up; higher
// than `max` is too long a climb.
const STAIRS = { width: 1, angle: 0.7, rise: 0.22, min: 0.6, max: 6 };
// A bahay kubo: its deck `raise` above the highest ground under it, a roof
// `rise` high over its walls, overhanging them by `eave` (and `overhang`
// past the gable ends).
const KUBO = { raise: 1.8, rise: 2.3, eave: 0.6, overhang: 0.35, steep: 2.5 };
const HALF_PI = Math.PI / 2;
const CORNERS = [[0.12, 0.12], [1.88, 0.12], [0.12, 1.88], [1.88, 1.88]];
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // neighbouring cell across each side

// What can be built. cost: planks (or logs) to finish it.
export const PIECES = [
  { id: 'floor', name: 'Floor', cost: 6, hint: 'A plank deck on posts, or on pilings (R turns its boards)' },
  { id: 'wall', name: 'Wall', cost: 6, hint: 'Along the edge of a floor (R turns it round the floor)' },
  { id: 'door', name: 'Door', cost: 7, hint: 'A wall with a doorway and its door: E opens and shuts it (R turns it round the floor)' },
  { id: 'roof', name: 'Roof', cost: 8, hint: 'Over a floor: shade, and shelter from the rain (R turns its ridge)' },
  { id: 'pilings', name: 'Pilings', cost: 4, material: 'log', hint: 'Log stilts in the ground or seabed, to build a floor on high above the sea' },
  { id: 'window', name: 'Window', cost: 5, hint: 'A wall with a window in it (R turns it round the floor)' },
  { id: 'railing', name: 'Railing', cost: 3, hint: 'Along a floor edge, so you don’t fall off (R turns it round the floor)' },
  { id: 'stairs', name: 'Stairs', cost: 5, hint: `Steps up to a raised floor from one of its edges, ${MAX_STAIRS} each (R turns them round the floor)` },
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
const EXPOSURE = { floor: 0.5, wall: 1, door: 1, window: 1.1, roof: 1.4, pilings: 0.3, railing: 0.8, stairs: 0.6 };
// Thick logs outlast planks.
const RESIST = { pilings: 5 };
// Condition back per plank (or log) used in a repair.
const REPAIR = { plank: 0.4, log: 0.5 };
// Ground each piece covers (m²), which stresses the land under it (see climate/entity.js).
const FOOTPRINT = { floor: CELL * CELL, pilings: 0.5, wall: 0.3, door: 0.3, window: 0.3, railing: 0.2, roof: 0, stairs: 0.8 };

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
// on pilings). dir 0 runs the boards along X, 1 along Z.
function floorParts(terrain, x0, z0, y, onPilings, dir = 0) {
  const parts = [];
  const joist = y - 0.14;
  if (!onPilings) {
    for (const [px, pz] of CORNERS) {
      const bottom = terrain.heightAt(x0 + px, z0 + pz) - 0.3, top = joist - 0.07;
      if (top - bottom > 0.05) upright(parts, 1, x0 + px, z0 + pz, bottom, top, 0.16, 0.16, 0);
    }
  }
  // The joists run across the boards.
  for (const k of [0.12, 1.88]) {
    if (dir) board(parts, 1, x0 + 1, joist, z0 + k, CELL, 0.14, 0.14, 0, 0, 0, true);
    else board(parts, 1, x0 + k, joist, z0 + 1, CELL, 0.14, 0.14, HALF_PI, 0, 0, true);
  }
  for (let k = 0; k < 6; k++) {
    const across = (k + 0.5) / 3;
    if (dir) board(parts, k + 1, x0 + across, y - 0.035, z0 + 1, CELL + 0.04, 0.07, 0.32, HALF_PI);
    else board(parts, k + 1, x0 + 1, y - 0.035, z0 + across, CELL + 0.04, 0.07, 0.32);
  }
  return parts;
}

// A log from one point to another, as a frame part (a brace).
function brace(parts, step, x1, y1, z1, x2, y2, z2, r) {
  const dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, len = Math.hypot(dx, dy, dz);
  e.set(0, Math.atan2(-dz, dx), Math.asin(dy / len));
  parts.push({ step, frame: true, log: true, matrix: new THREE.Matrix4().compose(pos.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2), q.setFromEuler(e), scl.set(len, r, r)) });
}

// Four logs driven into the ground (or seabed) at the corners, up to `top`.
// With `braces` (0 along X, 1 along Z), a diagonal log brace across each of
// the two sides that way, rising opposite ways, from clear of the ground
// or the sea up to just under the deck (none where they're too short).
function pilingParts(terrain, x0, z0, top, braces = null) {
  const parts = [];
  CORNERS.forEach(([px, pz], k) => upright(parts, k + 1, x0 + px, z0 + pz, terrain.heightAt(x0 + px, z0 + pz) - 0.8, top, 0.14, 0.14, k * 1.7, true));
  if (braces === null) return parts;
  const a = 0.12, b = CELL - 0.12, sea = uniforms.uWaterLevel.value;
  for (const s of [a, b]) {
    // From the foot of one corner post to the top of the other along this side.
    let [lx, lz, hx, hz] = braces ? [x0 + s, z0 + a, x0 + s, z0 + b] : [x0 + a, z0 + s, x0 + b, z0 + s];
    if (s === b) [lx, lz, hx, hz] = [hx, hz, lx, lz];
    const low = Math.max(terrain.heightAt(lx, lz), sea) + 0.4, high = top - 0.3;
    if (high - low > 0.8) brace(parts, 4, lx, low, lz, hx, high, hz, 0.07);
  }
  return parts;
}

// A door's hinge: at one side of its edge's opening, with the way along the
// edge (u) and out of the floor it was built from (n). It swings in, away
// from n.
function hingeOf({ ax, az, bx, bz, nx, nz }) {
  const ux = (bx - ax) / CELL, uz = (bz - az) / CELL;
  return { x: (ax + bx) / 2 - (ux * DOOR.width) / 2, z: (az + bz) / 2 - (uz * DOOR.width) / 2, ux, uz, nx, nz };
}
// A board of a door's leaf, swung open `angle` radians about its hinge:
// leaf { along (from the hinge), inward (off the leaf's face), y, size }.
function leafMatrix(h, leaf, angle, m) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const ax = h.ux * c - h.nx * s, az = h.uz * c - h.nz * s;    // along the leaf
  const ix = -h.nx * c - h.ux * s, iz = -h.nz * c - h.uz * s;  // off its inside face
  e.set(0, Math.atan2(-az, ax), 0);
  return m.compose(pos.set(h.x + ax * leaf.along + ix * leaf.inward, leaf.y, h.z + az * leaf.along + iz * leaf.inward), q.setFromEuler(e), scl.set(...leaf.size));
}
// The door itself, shut: three planks held by two battens on the inside,
// the last thing to go in.
function leafParts(edge, y, step) {
  const h = hingeOf(edge), w = DOOR.width - 0.03, parts = [];
  const leaves = [
    ...[0, 1, 2].map((k) => ({ along: 0.015 + ((k + 0.5) * w) / 3, inward: 0, y: y + DOOR.height / 2, size: [w / 3 - 0.01, DOOR.height - 0.06, 0.05] })),
    ...[0.45, 1.55].map((at) => ({ along: 0.015 + w / 2, inward: 0.045, y: y + at, size: [w - 0.06, 0.11, 0.04] })),
  ];
  for (const leaf of leaves) parts.push({ step, frame: false, leaf, matrix: leafMatrix(h, leaf, 0, new THREE.Matrix4()) });
  return parts;
}

// Six boards on edge between two corner posts. A door's doorway leaves a
// gap below the top board, a window one in the middle.
function wallParts(edge, y, type) {
  const { ax, az, bx, bz } = edge;
  const parts = [];
  const cost = PIECE[type].cost;
  const ux = (bx - ax) / CELL, uz = (bz - az) / CELL;
  const yaw = Math.atan2(-uz, ux);
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  // Posts just inside the ends, so walls meeting at a corner don't share one.
  const post = uz === 0 ? 0.14 : 0.15;
  for (const k of [0.07, CELL - 0.07]) upright(parts, 1, ax + ux * k, az + uz * k, y, y + WALL_HEIGHT + (uz === 0 ? 0 : 0.01), post, post, yaw);
  if (type === 'door') parts.push(...leafParts(edge, y, cost));
  const gap = type === 'door' ? { from: 0, to: DOOR.height, width: DOOR.width }
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

// Stairs from a floor's edge (its top at `top`) out and down to the
// ground, or to a lower floor in the way (ground.heightAt(x, z)): two
// stringers and a tread every STAIRS.rise or so.
// Returns { parts, bottom (the ground at their foot), run (how far out) }.
function stairsParts(ground, { ax, az, bx, bz, nx, nz }, top) {
  const ux = (bx - ax) / CELL, uz = (bz - az) / CELL, mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const pitch = Math.tan(STAIRS.angle);
  // Out from the edge until the slope down meets the ground (or a floor).
  let bottom = top - 12 * pitch;
  for (let out = 0.05; out < 12; out += 0.05) {
    const g = Math.min(top - 0.3, ground.heightAt(mx + nx * out, mz + nz * out));
    if (top - out * pitch <= g) {
      bottom = g;
      break;
    }
  }
  const run = Math.max(0.6, (top - bottom) / pitch);
  const rise = top - bottom, len = Math.hypot(rise, run), tilt = Math.atan2(rise, run);
  const parts = [];
  for (const sgn of [-1, 1]) {
    const k = sgn * (STAIRS.width / 2 - 0.04);
    board(parts, 1, mx + ux * k + (nx * run) / 2, (top + bottom) / 2 - 0.1, mz + uz * k + (nz * run) / 2, len + 0.1, 0.2, 0.06, Math.atan2(-nz, nx), 0, -tilt, true);
  }
  const steps = Math.max(2, Math.round(rise / STAIRS.rise)), depth = run / steps;
  for (let s = 1; s < steps; s++) {
    // Tread s, counted up from the ground: its top, and how far out it is.
    const h = bottom + (rise * s) / steps, out = run * (1 - s / steps) + depth / 2;
    board(parts, 1 + Math.floor((s / steps) * 4), mx + nx * out, h - 0.03, mz + nz * out, STAIRS.width, 0.06, depth + 0.06, Math.atan2(-uz, ux));
  }
  return { parts, bottom, run };
}

// A bahay kubo's roof over its 2 × 2 cells (x0, z0: the corner; y: the
// wall tops): a steep gable of nipa thatch in rows lapping down each side,
// the gable ends woven, a bamboo ridge pole and a thatch ridge cap,
// overhanging well to shed typhoon rain. dir 0 runs the ridge along X, 1
// along Z.
function kuboRoofParts(x0, z0, y, dir) {
  const parts = [];
  const cx = x0 + CELL, cz = z0 + CELL, length = 2 * CELL + 2 * KUBO.overhang;
  const slope = Math.atan2(KUBO.rise, CELL), run = (CELL + KUBO.eave) / Math.cos(slope);
  const yaw = dir ? HALF_PI : 0;
  // In the roof's own frame: lx along the ridge, lz across it.
  const add = (step, skin, lx, ly, lz, sx, sy, sz, tilt = 0, roll = 0) => {
    board(parts, step, dir ? cx + lz : cx + lx, ly, dir ? cz - lx : cz + lz, sx, sy, sz, yaw, tilt, roll, !skin);
    if (skin) parts.at(-1).skin = skin;
  };
  add(1, null, 0, y + KUBO.rise - 0.12, 0, length, 0.13, 0.13);
  for (const end of [-CELL, CELL]) {
    for (let k = 0; k < 10; k++) {
      const lz = -CELL + (k + 0.5) * (CELL / 5);
      const h = KUBO.rise * (1 - Math.abs(lz) / CELL);
      add(2, 'sawali', end, y + h / 2, lz, h, 0.06, CELL / 5 - 0.01, 0, HALF_PI);
    }
  }
  const rows = 7, width = run / rows;
  for (const side of [1, -1]) {
    for (let b = 0; b < rows; b++) {
      const s = (b + 0.5) * width;   // down the slope from the ridge
      add(3, 'thatch', 0, y + KUBO.rise - s * Math.sin(slope) + 0.1, side * s * Math.cos(slope), length, 0.16, width * 1.3, side * slope);
    }
  }
  add(4, 'thatch', 0, y + KUBO.rise + 0.12, 0, length + 0.1, 0.2, 0.55);
  return parts;
}

// The kubo's look on parts made for wood: posts, poles and frames become
// slender bamboo; boards become `skin` (woven bamboo walls, split-bamboo
// floors and steps).
const THIN = new THREE.Vector3(1, 0.6, 0.6);
function bamboo(parts, skin) {
  for (const part of parts) {
    if (part.skin) continue;
    if (!(part.up || part.frame || part.log)) {
      part.skin = skin;
      continue;
    }
    part.log = true;
    if (part.up) {
      part.up.w *= 0.6;
      part.up.d *= 0.6;
      uprightMatrix(part.up, part.up.bottom, part.up.top, part.matrix);
    } else {
      part.matrix.scale(THIN);
    }
  }
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
// kubo: the bahay kubo's materials (kubo.js).
export function createBuilding(scene, { terrain, colliders, wood, kubo, rng, shadows, takeWood, release, onMessage, onSound, onChange, onImpact }) {
  // Grid cells with a floor and/or pilings: { i, j, x0, z0, y (deck top), floor, roof, pilings, top (of the pilings) }.
  const cells = new Map();
  const edges = new Map();   // walls, windows, doors and railings by edge key
  const stairs = new Map();  // stairs by edge key (they can share an edge with a door)
  const pieces = [];
  let dirty = true;

  // --- Drawing: built boards and logs, blueprints still to fill, and the placement preview.
  const boardGeo = boardGeometry(), logGeo = logGeometry();
  const solid = new THREE.InstancedMesh(boardGeo, wood.plank, MAX_SOLID);
  solid.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SOLID * 3), 3);
  const ghost = new THREE.InstancedMesh(boardGeo, wood.ghost, MAX_GHOST);
  const ghostLogs = new THREE.InstancedMesh(logGeo, wood.ghost, MAX_LOGS);
  const previewMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, fog: false });
  const preview = new THREE.InstancedMesh(boardGeo, previewMat, 256);
  const previewLogs = new THREE.InstancedMesh(logGeo, previewMat, 96);
  for (const mesh of [solid, ghost, ghostLogs, preview, previewLogs]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }
  solid.castShadow = shadows;
  solid.receiveShadow = true;
  ghost.renderOrder = ghostLogs.renderOrder = preview.renderOrder = previewLogs.renderOrder = 2;
  // Built logs, one mesh per kind of bark (or bamboo), and the kubo's boards,
  // one mesh per skin, made when first needed.
  const logs = {}, skins = {};
  function instanced(geometry, material, max) {
    const mesh = new THREE.InstancedMesh(geometry, material, max);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return { mesh, n: 0 };
  }
  function logMesh(bark) {
    logs[bark] ??= instanced(logGeo, [bark === 'bamboo' ? kubo.bamboo : wood.bark[bark], wood.endGrain, wood.endGrain], MAX_LOGS);
    return logs[bark];
  }
  function skinMesh(skin) {
    skins[skin] ??= instanced(boardGeo, kubo[skin], MAX_SKIN);
    return skins[skin];
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
    } else if (part.skin) {
      const k = skinMesh(part.skin);
      if (k.n >= MAX_SKIN) return;
      k.mesh.setMatrixAt(k.n, matrix);
      k.mesh.setColorAt(k.n++, color);
    } else if (s < MAX_SOLID) {
      solid.setMatrixAt(s, matrix);
      solid.setColorAt(s++, color);
    }
  }
  function render() {
    s = 0;
    let g = 0, gl = 0;
    for (const l of [...Object.values(logs), ...Object.values(skins)]) l.n = 0;
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
    for (const { mesh, n } of [...Object.values(logs), ...Object.values(skins)]) {
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
  // What stairs down from a floor at `top` land on: the ground, or a lower
  // floor (built or planned) that's in the way.
  const stepsGround = (top) => ({
    heightAt(x, z) {
      const c = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))), g = terrain.heightAt(x, z);
      return c?.floor && c.y < top - 0.3 ? Math.max(g, c.y) : g;
    },
  });
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

  // dir: which way its boards run (R).
  function planFloor(ray, dir) {
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
    if (cell?.floor) return { type: 'floor', i, j, x0, z0, y: cell.y, dir, parts: floorParts(terrain, x0, z0, cell.y, !!cell.pilings, dir), reason: 'There’s a floor here already' };
    // On pilings, the deck sits on top of them.
    if (cell?.pilings) {
      const y = cell.top + DECK;
      return { type: 'floor', i, j, x0, z0, y, dir, onPilings: true, parts: floorParts(terrain, x0, z0, y, true, dir), ok: true };
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
    const plan = { type: 'floor', i, j, x0, z0, y, dir, parts: floorParts(terrain, x0, z0, y, false, dir) };
    if (y - low > MAX_POST) return { ...plan, reason: 'Too high off the ground here: build pilings first' };
    if (blocked(x0, z0)) return { ...plan, reason: 'Something’s in the way' };
    return { ...plan, ok: true };
  }

  // dir: which way the braces go (R); raise: how high the deck stands (Z).
  function planPilings(ray, dir, raise) {
    if (!groundHit(ray, 12)) return null;
    const i = Math.floor(hit.x / CELL), j = Math.floor(hit.z / CELL), x0 = i * CELL, z0 = j * CELL;
    const { high, low } = groundUnder(x0, z0);
    let top = Math.max(high, uniforms.uWaterLevel.value) + DECK_LEVELS[raise % DECK_LEVELS.length];
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
    const plan = { type: 'pilings', i, j, x0, z0, top, low, dir, parts: pilingParts(terrain, x0, z0, top, dir) };
    if (cells.has(cellKey(i, j))) return { ...plan, reason: 'Something’s built here already' };
    if (top - low > MAX_PILING) return { ...plan, reason: 'Too deep here' };
    if (blocked(x0, z0)) return { ...plan, reason: 'Something’s in the way' };
    return { ...plan, ok: true };
  }

  // The floor under the crosshair and the side of it a piece goes on: the
  // edge nearest the crosshair, turned `turn` quarters round the floor (R).
  function floorSide(ray, turn) {
    const h = floorHit(ray, false);
    if (!h) return null;
    const c = h.cell;
    const fx = h.x - c.x0, fz = h.z - c.z0;
    const near = [fz, CELL - fx, CELL - fz, fx];
    const side = (near.indexOf(Math.min(...near)) + turn) % 4;
    return { c, side, edge: edgeOf(c.i, c.j, side) };
  }

  // Walls, windows, doors and railings: on a floor's edge.
  function planEdge(type, ray, turn) {
    const at = floorSide(ray, turn);
    if (!at) return null;
    const { c, side, edge } = at;
    const parts = type === 'railing' ? railingParts(edge, c.y) : wallParts(edge, c.y, type);
    const plan = { type, cell: c, edge, side, y: c.y, parts };
    if (edges.has(edge.key)) return { ...plan, reason: 'Something’s on this edge already' };
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

  // Stairs you've built yourself (not a kubo's own steps): MAX_STAIRS at most.
  const ownStairs = () => pieces.filter((p) => p.type === 'stairs' && !p.remote && !p.builtIn).length;

  // Stairs: down from a floor's edge to the ground, or onto a lower floor.
  function planStairs(ray, turn) {
    const at = floorSide(ray, turn);
    if (!at) return null;
    const { c, side, edge } = at;
    const { parts, bottom, run } = stairsParts(stepsGround(c.y), edge, c.y);
    const plan = { type: 'stairs', cell: c, edge, side, y: c.y, bottom, run, parts };
    const on = edges.get(edge.key);
    if (stairs.has(edge.key)) return { ...plan, reason: 'There are stairs here already' };
    if (on && on.type !== 'door') return { ...plan, reason: `There’s a ${on.name} in the way` };
    // A floor beside it lower down is fine (the stairs go down onto it);
    // one about as high you can just step onto.
    const other = cells.get(cellKey(c.i + SIDES[side][0], c.j + SIDES[side][1]));
    if (other?.floor && other.y > c.y + 0.05) return { ...plan, reason: 'There’s a higher floor in the way' };
    if (other?.floor && other.y > c.y - STAIRS.min) return { ...plan, reason: 'The floor beside it is close enough to step onto' };
    if (c.y - bottom < STAIRS.min) return { ...plan, reason: 'Too low for stairs: just step up' };
    if (c.y - bottom > STAIRS.max) return { ...plan, reason: 'Too high for stairs here: build up to it from a lower floor' };
    if (ownStairs() >= MAX_STAIRS) return { ...plan, reason: `You can build ${MAX_STAIRS} stairs at most` };
    return { ...plan, ok: true };
  }

  // --- The bahay kubo: cells (i0..i0+1, j0..j0+1), its door on side `turn`
  // (0 north, 1 east, 2 south, 3 west) with steps down from it.
  const BLOCK = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const SIDE_CELLS = [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[0, 1], [1, 1]], [[0, 0], [0, 1]]];
  // Whether one fits there, and where its deck goes: { ok, reason, deck }.
  function kuboFit(i0, j0, turn) {
    let high = -Infinity, low = Infinity, reason = null;
    for (const [a, b] of BLOCK) {
      const x0 = (i0 + a) * CELL, z0 = (j0 + b) * CELL;
      const g = groundUnder(x0, z0);
      high = Math.max(high, g.high);
      low = Math.min(low, g.low);
      if (cells.has(cellKey(i0 + a, j0 + b))) reason ??= 'Something’s built here already';
      else if (blocked(x0, z0)) reason ??= 'Something’s in the way';
    }
    const sea = uniforms.uWaterLevel.value;
    const deck = Math.max(high, sea + 0.5) + KUBO.raise;
    if (low < sea + 0.1) reason ??= 'Not in the water';
    if (high - low > KUBO.steep) reason ??= 'Too steep for a bahay kubo';
    // Clear ground in front of the door for the steps.
    const [a, b] = SIDE_CELLS[turn][0], [di, dj] = SIDES[turn];
    const i = i0 + a + di, j = j0 + b + dj;
    if (cells.get(cellKey(i, j))?.floor) reason ??= 'Keep the doorway clear';
    else if (blocked(i * CELL, j * CELL)) reason ??= 'Something’s in the way of the steps';
    return { ok: !reason, reason, deck };
  }
  // The plans for each of its pieces, in building order (cellIJ: the cell a
  // piece stands on, found once that cell's floor is down).
  function kuboPlans(i0, j0, turn, deck) {
    const plans = [];
    for (const [a, b] of BLOCK) {
      const i = i0 + a, j = j0 + b, x0 = i * CELL, z0 = j * CELL;
      plans.push({ type: 'pilings', i, j, x0, z0, top: deck - DECK, low: groundUnder(x0, z0).low, parts: bamboo(pilingParts(terrain, x0, z0, deck - DECK)) });
    }
    for (const [a, b] of BLOCK) {
      const i = i0 + a, j = j0 + b, x0 = i * CELL, z0 = j * CELL;
      plans.push({ type: 'floor', i, j, x0, z0, y: deck, onPilings: true, parts: bamboo(floorParts(terrain, x0, z0, deck, true), 'slat') });
    }
    // Two edges a side: the door and a window at the front, a wall and a
    // window at the back, a window and a wall at each end.
    for (let side = 0; side < 4; side++) {
      const kinds = side === turn ? ['door', 'window'] : side === (turn + 2) % 4 ? ['wall', 'window'] : ['window', 'wall'];
      SIDE_CELLS[side].forEach(([a, b], k) => {
        const cellIJ = [i0 + a, j0 + b], edge = edgeOf(i0 + a, j0 + b, side);
        plans.push({ type: kinds[k], cellIJ, edge, side, y: deck, parts: bamboo(wallParts(edge, deck, kinds[k]), 'sawali') });
        if (kinds[k] !== 'door') return;
        const steps = stairsParts(stepsGround(deck), edge, deck);
        plans.push({ type: 'stairs', cellIJ, edge, side, y: deck, bottom: steps.bottom, run: steps.run, parts: bamboo(steps.parts, 'slat') });
      });
    }
    const dir = turn % 2 ? 1 : 0;   // the ridge along the door side
    plans.push({ type: 'roof', cellIJ: [i0, j0], dir, y: deck + WALL_HEIGHT, parts: kuboRoofParts(i0 * CELL, j0 * CELL, deck + WALL_HEIGHT, dir) });
    bamboo(plans.at(-1).parts);
    return plans;
  }

  // --- Sharing (a multiplayer match): { team, teamName(team), send(msg) }.
  let sharing = null;
  const byKey = (key) => pieces.find((p) => p.key === key);
  const share = (msg) => sharing?.send(msg);
  const stateOf = (piece) => ({ op: 'state', key: piece.key, added: piece.added, done: piece.done, joints: piece.joints, health: piece.health, open: !!piece.open });
  const enemy = (piece) => sharing && piece.team !== undefined && piece.team !== sharing.team;
  // What another game needs to place the same piece.
  const specOf = (plan) => ({
    type: plan.type, i: plan.i ?? plan.cell.i, j: plan.j ?? plan.cell.j, y: plan.y, top: plan.top, low: plan.low,
    onPilings: !!plan.onPilings, side: plan.side, dir: plan.dir,
  });
  // A piece someone else placed, from its spec: null if it doesn't fit here.
  function planFrom(spec) {
    const { type, i, j } = spec;
    if (!PIECE[type] || !Number.isInteger(i) || !Number.isInteger(j)) return null;
    const x0 = i * CELL, z0 = j * CELL, dir = spec.dir === 1 ? 1 : 0;
    if (type === 'floor') return { type, i, j, x0, z0, y: spec.y, dir, onPilings: spec.onPilings, parts: floorParts(terrain, x0, z0, spec.y, spec.onPilings, dir), ok: true };
    if (type === 'pilings') return { type, i, j, x0, z0, top: spec.top, low: spec.low, dir, parts: pilingParts(terrain, x0, z0, spec.top, dir), ok: true };
    const cell = cells.get(cellKey(i, j));
    if (!cell?.floor) return null;
    if (type === 'roof') return cell.roof ? null : { type, cell, dir: spec.dir, y: spec.y, parts: roofParts(cell.x0, cell.z0, spec.y, spec.dir), ok: true };
    const edge = edgeOf(i, j, spec.side);
    if (type === 'stairs') {
      if (stairs.has(edge.key)) return null;
      const { parts, bottom, run } = stairsParts(stepsGround(cell.y), edge, cell.y);
      return { type, cell, edge, side: spec.side, y: cell.y, bottom, run, parts, ok: true };
    }
    if (edges.has(edge.key)) return null;
    const parts = type === 'railing' ? railingParts(edge, cell.y) : wallParts(edge, cell.y, type);
    return { type, cell, edge, side: spec.side, y: cell.y, parts, ok: true };
  }

  // --- Building up and taking down.
  // owner: whose it is in a match ({ team, remote: placed by someone else }).
  function place(plan, owner = {}) {
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
    // each board of a door or window (not the opening, so a swing goes
    // through it), or the whole piece.
    const byPart = plan.type === 'pilings' || plan.type === 'door' || plan.type === 'window';
    piece.aim = plan.type === 'floor'
      ? [new THREE.Box3(new THREE.Vector3(plan.x0, plan.y - 0.3, plan.z0), new THREE.Vector3(plan.x0 + CELL, plan.y, plan.z0 + CELL))]
      : byPart ? piece.parts.map((part) => bounds([part])) : [piece.box];
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
    } else if (plan.type === 'stairs') {
      stairs.set(plan.edge.key, piece);
      piece.cell = plan.cell;
      piece.edge = plan.edge;
      piece.low = plan.bottom;
      piece.run = plan.run;
    } else {
      edges.set(plan.edge.key, piece);
      piece.cell = plan.cell;
      piece.edge = plan.edge;
      piece.low = plan.y;
      if (plan.type === 'door') Object.assign(piece, { hinge: hingeOf(plan.edge), open: false, swing: 0 });
    }
    piece.center = piece.box.getCenter(new THREE.Vector3());
    piece.key = plan.type === 'stairs' ? `stairs:${piece.edge.key}` : piece.edge ? `edge:${piece.edge.key}` : `${piece.type}:${piece.cell.i},${piece.cell.j}`;
    piece.team = owner.team ?? sharing?.team;
    piece.remote = !!owner.remote;
    pieces.push(piece);
    dirty = true;
    return piece;
  }

  // A door, swung `swing` (0 shut .. 1 open) of the way: its boards, what
  // you aim at, and where it stops you.
  function hang(piece) {
    const angle = DOOR.open * piece.swing * piece.swing * (3 - 2 * piece.swing);
    for (const part of piece.parts) if (part.leaf) leafMatrix(piece.hinge, part.leaf, angle, part.matrix);
    piece.aim = piece.parts.map((part) => bounds([part]));
    if (piece.leafSegment) {
      const h = piece.hinge, c = Math.cos(angle), s = Math.sin(angle), w = DOOR.width - 0.02;
      Object.assign(piece.leafSegment, { ax: h.x, az: h.z, bx: h.x + (h.ux * c - h.nx * s) * w, bz: h.z + (h.uz * c - h.nz * s) * w });
    }
    dirty = true;
  }
  // Opens or shuts a door (its team's, in a match), in every game.
  const doors = new Set();   // the ones still swinging
  function swingDoor(piece, open) {
    piece.open = open;
    doors.add(piece);
    share(stateOf(piece));
    onSound?.('knock', 0.45);
    return {};
  }

  // Finished: what makes it solid.
  function complete(piece) {
    piece.done = true;
    const { cell } = piece;
    if (piece.type === 'floor') {
      piece.deck = { x0: cell.x0, z0: cell.z0, x1: cell.x0 + CELL, z1: cell.z0 + CELL, top: cell.y, bottom: cell.y - DECK };
    } else if (piece.type === 'pilings') {
      piece.posts = piece.parts.filter((part) => part.up).map(({ up }) => ({ x: up.x, z: up.z, r: up.w, y0: up.bottom, y1: up.top }));
    } else if (piece.type === 'stairs') {
      // What you walk on: a slope from the floor's edge out to its foot.
      const { ax, az, bx, bz, nx, nz } = piece.edge;
      piece.steps = { mx: (ax + bx) / 2, mz: (az + bz) / 2, ux: (bx - ax) / CELL, uz: (bz - az) / CELL, nx, nz, run: piece.run, top: cell.y, bottom: piece.low };
    } else if (piece.edge) {
      const { ax, az, bx, bz } = piece.edge, y = piece.low;
      const ux = (bx - ax) / CELL, uz = (bz - az) / CELL;
      if (piece.type === 'railing') {
        piece.segments = [{ ax, az, bx, bz, y0: y, y1: y + RAIL }];
      } else if (piece.type === 'door') {
        // Either side of the doorway, the lintel over it, and the door,
        // where it's swung to.
        const side = (CELL - DOOR.width) / 2;
        piece.leafSegment = { y0: y, y1: y + DOOR.height };
        piece.segments = [
          { ax, az, bx: ax + ux * side, bz: az + uz * side, y0: y, y1: y + WALL_HEIGHT },
          { ax: bx - ux * side, az: bz - uz * side, bx, bz, y0: y, y1: y + WALL_HEIGHT },
          { ax, az, bx, bz, y0: y + DOOR.height, y1: y + WALL_HEIGHT },
          piece.leafSegment,
        ];
        // Looking into the doorway finds the door, open or shut (E), though
        // a swing goes through it when it's open.
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, w = DOOR.width / 2, d = 0.25;
        piece.opening = new THREE.Box3(
          new THREE.Vector3(mx - Math.abs(ux) * w - Math.abs(uz) * d, y, mz - Math.abs(uz) * w - Math.abs(ux) * d),
          new THREE.Vector3(mx + Math.abs(ux) * w + Math.abs(uz) * d, y + DOOR.height, mz + Math.abs(uz) * w + Math.abs(ux) * d),
        );
        hang(piece);
      } else {
        piece.segments = [{ ax, az, bx, bz, y0: y, y1: y + WALL_HEIGHT }];
      }
    }
    onImpact?.({ kind: 'build', x: piece.center.x, z: piece.center.z, area: FOOTPRINT[piece.type], remote: piece.remote });
    // A roof over a floor on pilings: the house on stilts of the Philippine coast.
    if (piece.type === 'roof' && cell.pilings && !piece.remote) {
      onMessage?.('A roofed house on stilts: a bahay kubo, raised above the floods like the houses of the Philippine coast.');
    }
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
        share(stateOf(piece));
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
    if (piece.added >= piece.cost) complete(piece);
    share(stateOf(piece));
    if (!piece.done) return {};
    return { notify: `Built a ${piece.name}`, joinery: joineryFor(piece) };
  }

  function repair(piece) {
    const w = takeWood(piece.material);
    if (!w) return null;
    if (w.bark) piece.barks.push(w.bark);
    piece.health = Math.min(1, piece.health + REPAIR[piece.material]);
    if (piece.health > 0.5) piece.warnedLow = false;
    dirty = true;
    share(stateOf(piece));
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
      const key = edgeOf(i, j, side).key;
      const other = edges.get(key), steps = stairs.get(key);
      if (other && !cells.get(cellKey(i + di, j + dj))?.floor) on.push(other);
      if (steps?.cell === piece.cell) on.push(steps);
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
      for (const c of piece.cells ?? [cell]) if (c.roof === piece) c.roof = null;
    } else if (piece.type === 'stairs') {
      stairs.delete(piece.edge.key);
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
    share({ op: 'remove', key: piece.key });
    onSound?.('knock', 0.5);
    return { notify: piece.done ? `Took the ${piece.name} apart` : 'Blueprint cleared' };
  }

  // A tool's blow on a finished piece on your own island: it loses
  // condition, and at nothing it breaks (in a match blows go through the
  // server instead: apply({ op: 'hit' })).
  function strike(piece, tool) {
    if (!pieces.includes(piece) || !piece.done) return null;
    piece.health -= damageOf('piece', tool) / PIECE_HP;
    piece.warnedLow = true;   // you know: no warning that it's wearing out
    dirty = true;
    if (piece.health > 0) {
      onSound?.('knock', 0.8);
      return { used: true };
    }
    smash(piece);
    return { used: true, notify: `Broke the ${piece.name}` };
  }

  // Broken with tools on your own island: it falls, with whatever stood on
  // it, and half the wood in each is left lying where it stood.
  function smash(piece) {
    if (!pieces.includes(piece)) return;
    const on = standingOn(piece);
    free(piece, Math.ceil((piece.done ? piece.cost : piece.added) / 2));
    unregister(piece);
    onSound?.('break', 1);
    for (const other of on) smash(other);
  }

  // Broken by tools in a match: it falls, with what stood on it, the same
  // in every game.
  function destroy(piece) {
    if (!pieces.includes(piece)) return;
    const on = standingOn(piece);
    unregister(piece);
    onSound?.('break', 1);
    for (const other of on) destroy(other);
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
    share({ op: 'remove', key: piece.key });
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
      // The sea creeping up on it (pilings are meant to stand in it, and
      // stairs may reach down into it).
      if (piece.type !== 'pilings' && piece.type !== 'stairs') {
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
    if (piece.type === 'door') bits.push(piece.open ? 'open' : 'shut');
    if (piece.wet > 0.5) bits.push('soaked');
    const water = piece.water ?? uniforms.uWaterLevel.value;
    if (piece.type === 'pilings') bits.push(`top ${(piece.top - water).toFixed(1)} m above the water`);
    else if (piece.type !== 'stairs') bits.push(piece.low < water ? 'under water' : `${(piece.low - water).toFixed(1)} m above the water`);
    return bits.join(' · ');
  }

  const v = new THREE.Vector3();
  return {
    // The highest finished floor (or stairs) under (x, z) whose top is below maxY.
    floorAt(x, z, maxY) {
      const c = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      let y = c?.floor?.done && c.y <= maxY ? c.y : -Infinity;
      for (const piece of stairs.values()) {
        const s = piece.done && piece.steps;
        if (!s) continue;
        const dx = x - s.mx, dz = z - s.mz;
        const along = dx * s.ux + dz * s.uz, out = dx * s.nx + dz * s.nz;
        if (Math.abs(along) > STAIRS.width / 2 + 0.05 || out < -0.05 || out > s.run) continue;
        const h = s.top - (Math.max(0, out) / s.run) * (s.top - s.bottom);
        if (h <= maxY && h > y) y = h;
      }
      return y;
    },

    // Keeps a body (feet at p, radius r, this tall) out of walls, railings
    // and pilings, and out of floors higher than it can step onto.
    collide(p, r, height, step) {
      for (const piece of pieces) {
        if (!piece.done || piece.type === 'roof' || piece.type === 'stairs') continue;
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

    // 1 under a finished roof, else 0.
    shelterAt(x, y, z) {
      const c = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      return c?.roof?.done && y < c.y + WALL_HEIGHT ? 1 : 0;
    },

    // Where a piece would go: { ok, reason, parts, ... }, or null when
    // there's nothing to build on under the crosshair. turn (R) turns it,
    // raise (Z) sets how high pilings stand.
    plan(type, ray, turn = 0, raise = 0) {
      if (type === 'floor') return planFloor(ray, turn % 2);
      if (type === 'pilings') return planPilings(ray, turn % 2, raise);
      if (type === 'roof') return planRoof(ray, turn % 2);
      if (type === 'stairs') return planStairs(ray, turn % 4);
      return planEdge(type, ray, turn % 4);
    },

    // Where a bahay kubo would go, aiming at the ground (turn: R, which side
    // its door faces): { ok, reason, i0, j0, turn, deck, x, z, parts }, or
    // null with no ground in reach. It goes up on 2 × 2 cells centred on
    // the grid corner nearest the crosshair.
    kuboPlan(ray, turn = 0) {
      if (!groundHit(ray, 12)) return null;
      const i0 = Math.round(hit.x / CELL) - 1, j0 = Math.round(hit.z / CELL) - 1, t = turn % 4;
      const fit = kuboFit(i0, j0, t);
      return { ...fit, i0, j0, turn: t, x: (i0 + 1) * CELL, z: (j0 + 1) * CELL, parts: kuboPlans(i0, j0, t, fit.deck).flatMap((p) => p.parts) };
    },

    // Whether a bahay kubo fits on those cells: { ok, reason, deck }.
    kuboFits: (i0, j0, turn) => kuboFit(i0, j0, turn),

    // Puts up a bahay kubo all at once ({ i0, j0, turn, deck }, the same in
    // every game), for a team (owner: { team }). Its pieces are as sturdy as
    // well-joined ones; they can be repaired, and broken by another team's
    // tools, but not taken apart.
    buildKubo({ i0, j0, turn, deck }, owner = {}) {
      for (const plan of kuboPlans(i0, j0, turn, deck)) {
        if (plan.cellIJ) {
          plan.cell = cells.get(cellKey(...plan.cellIJ));
          if (!plan.cell?.floor) continue;
        }
        const piece = place(plan, { ...owner, remote: true });
        Object.assign(piece, { builtIn: 'kubo', name: `bahay kubo ${piece.name}`, barks: Array(16).fill('bamboo'), added: piece.cost, joints: 0.8 });
        if (plan.type === 'roof') {
          piece.cells = BLOCK.map(([a, b]) => cells.get(cellKey(i0 + a, j0 + b))).filter(Boolean);
          for (const c of piece.cells) c.roof = piece;
        }
        complete(piece);
      }
      dirty = true;
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
      const piece = place(plan);
      share({ op: 'place', key: piece.key, plan: specOf(plan) });
      return piece;
    },

    // A multiplayer match: share what's built ({ team, teamName(team),
    // send(msg) }), and stop the weather wearing it down.
    share(config) { sharing = config; },

    // A change made in someone else's game: { op: 'place', key, team, plan },
    // { op: 'state', key, added, done, joints, health, open (a door) },
    // { op: 'remove', key } or { op: 'hit', key, amount } (condition lost
    // to a tool).
    apply(msg) {
      if (msg.op === 'place') {
        if (byKey(msg.key)) return;
        const plan = planFrom(msg.plan ?? {});
        if (plan) place(plan, { team: msg.team, remote: true });
        return;
      }
      const piece = byKey(msg.key);
      if (!piece) return;
      if (msg.op === 'state') {
        piece.added = clamp(Math.floor(msg.added) || 0, 0, piece.cost);
        if (msg.joints != null) piece.joints = clamp(Number(msg.joints) || 0, 0, 1);
        if (Number.isFinite(msg.health)) piece.health = clamp(msg.health, 0.01, 1);
        if (msg.done && !piece.done) complete(piece);
        if (piece.type === 'door' && typeof msg.open === 'boolean' && msg.open !== piece.open) {
          piece.open = msg.open;
          doors.add(piece);
        }
        dirty = true;
      } else if (msg.op === 'remove') {
        unregister(piece);
      } else if (msg.op === 'hit' && piece.done) {
        piece.health -= Number(msg.amount) || 0;
        dirty = true;
        if (piece.health <= 0) destroy(piece);
      }
    },

    // The finished piece a swing along ray would hit within reach (a
    // match's fighting): { key, team, kubo (part of a bahay kubo), distance },
    // or null.
    aimed(ray, reach) {
      let best = null;
      for (const piece of pieces) {
        if (!piece.done || piece.center.distanceToSquared(ray.origin) > 100) continue;
        for (const box of piece.aim) {
          if (box.containsPoint(ray.origin) || !ray.intersectBox(box, v)) continue;
          const distance = v.distanceTo(ray.origin);
          if (distance <= reach && (!best || distance < best.distance)) best = { key: piece.key, team: piece.team, kubo: !!piece.builtIn, distance };
        }
      }
      return best;
    },

    // The piece under the crosshair, as { score, prompt, dim, act, hold, use }.
    // E adds the plank (or log) you're carrying to a blueprint, repairs a
    // worn piece with it, or with empty arms reworks the joints; holding X
    // takes the piece down; a swing of the tool in hand (tool: its kind)
    // breaks a finished one (in a match the swing's strike does that: see
    // match/bedwars.js).
    focus(ray, carrying, tool) {
      let best = null, bestT = REACH;
      for (const piece of pieces) {
        if (piece.center.distanceToSquared(ray.origin) > 100) continue;
        for (const box of piece.opening ? [...piece.aim, piece.opening] : piece.aim) {
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
      // A tool can break it: anything finished, but in a match not your own
      // team's bahay kubo, and only once the fighting is on.
      const ownKubo = sharing && piece.builtIn && piece.team === sharing.team;
      const breaks = piece.done && !!tool && !carrying && !ownKubo && (sharing?.canBreak?.() ?? true);
      const smashing = breaks ? [['Right-click', 'Break it']] : [];
      const use = breaks && !sharing ? () => strike(piece, tool) : null;
      if (enemy(piece)) {
        const state = piece.done ? `${Math.ceil(piece.health * 100)}%` : 'blueprint';
        const locked = piece.type === 'door' && piece.done ? ` · ${piece.open ? 'open' : 'locked'}` : '';
        return { score, key: piece, dim: !breaks, prompt: [...smashing, [null, `${sharing.teamName(piece.team)}’s ${piece.name} · ${state}${locked}`]] };
      }
      const has = carrying?.kind === wood;
      const fix = piece.done && has && piece.health < 0.97;
      // A finished door, with your arms empty: open it or shut it.
      const door = piece.type === 'door' && piece.done && !carrying ? [['E', piece.open ? 'Shut the door' : 'Open the door'], () => swingDoor(piece, !piece.open)] : null;
      // A bahay kubo: repairs, but no taking it apart for its wood.
      if (piece.builtIn) {
        const act = fix ? () => repair(piece) : door?.[1] ?? null;
        const first = fix ? [['E', `Repair with a ${wood} (+${Math.round(REPAIR[wood] * 100)}%)`]] : door ? [door[0]] : [];
        return { score, key: piece, dim: !act && !breaks, act, prompt: [...first, ...smashing, [null, describe(piece)]] };
      }
      const hold = () => takeDown(piece);
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
      if (fix) {
        prompt.push(['E', `Repair with a ${wood} (+${Math.round(REPAIR[wood] * 100)}%)`]);
        act = () => repair(piece);
      } else if (door) {
        prompt.push(door[0]);
        act = door[1];
      } else if (!carrying) {
        prompt.push(['E', piece.joints == null ? 'Join the frame' : 'Rework the joints']);
        act = () => ({ joinery: joineryFor(piece) });
      }
      prompt.push(...smashing, ['X', 'Hold to take apart'], [null, describe(piece)]);
      return { score, key: piece, dim: !act && !breaks, hold, act, use, prompt };
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
      if (dt > 0 && !sharing) wear(dt, sea, weather);
      // Doors swinging open or shut.
      for (const piece of doors) {
        if (!pieces.includes(piece)) {
          doors.delete(piece);
          continue;
        }
        const to = piece.open ? 1 : 0;
        piece.swing = to > piece.swing ? Math.min(to, piece.swing + dt / DOOR.time) : Math.max(to, piece.swing - dt / DOOR.time);
        if (piece.done) hang(piece);
        if (piece.swing === to) doors.delete(piece);
      }
      if (dirty) {
        dirty = false;
        render();
      }
    },

    get count() { return { pieces: pieces.length, built: pieces.filter((p) => p.done).length }; },
  };
}
