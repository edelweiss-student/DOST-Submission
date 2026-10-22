import { TEAMS } from './teams.js';

const SHORE = 1.2;     // m above the sea: where the beach starts
const DRY = 5;         // m: high enough to stay dry as the sea rises (2.4 m, and storm surges 1.4 m more)
const STEEP = 0.12;    // steepest ground for a base

// Where each team's base is: a little inland from its diagonal shore, on
// flat ground that stays dry. It's worked out from the island itself, so
// every player finds the same spots. If the diagonal doesn't work there (a
// cliff, a bay, the islet in the way) it tries a little to either side.
// Returns [{ x, z, yaw }] in TEAMS order, each facing the middle of the island.
export function findBases(terrain) {
  return TEAMS.map(({ dir }) => {
    const bearing = Math.atan2(dir[1], dir[0]);
    for (let k = 0; k <= 24; k++) {
      // The diagonal, then 2.5° either side of it, then 5°, ... up to 30°.
      const spot = inland(terrain, bearing + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 72));
      if (spot) return spot;
    }
    return inland(terrain, bearing, true) ?? { x: dir[0] * 70, z: dir[1] * 70, yaw: Math.atan2(dir[0], dir[1]) };
  });
}

// The first good spot 20 to 80 m in from the shore along a bearing (radians,
// from +X towards +Z), or with anyDry the first dry one; null if there's none.
function inland(terrain, bearing, anyDry = false) {
  const cx = Math.cos(bearing), cz = Math.sin(bearing);
  const { islet } = terrain;
  let shore = null;
  for (let r = 330; r > 30; r -= 2) {
    const x = cx * r, z = cz * r;
    // The islet's beach doesn't count: look for the island's own.
    if (Math.hypot(x - islet.x, z - islet.z) < islet.r * 2.4) {
      shore = null;
      continue;
    }
    const h = terrain.heightAt(x, z);
    if (shore === null) {
      if (h > SHORE) shore = r;
      continue;
    }
    const inward = shore - r;
    if (inward < 20) continue;
    if (inward > 80) return null;
    if (anyDry ? h > SHORE : h > DRY && h < 25 && terrain.slopeAt(x, z) < STEEP) {
      return { x, z, yaw: Math.atan2(cx, cz) };
    }
  }
  return null;
}
