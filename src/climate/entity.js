import { WORLD, clamp, lerp } from '../shared.js';
import { SPECIES } from '../world/trees.js';

// The Climate Entity: the island's climate as something that answers what
// you do to the island, not dice. It keeps a tally, region by region, of
// the damage done (trees felled, plants stripped, ground built over),
// turns it into ecological stress, and from the island's stress works out
// the climate's pressure P (0..1): nothing else drives it. The pressure
// sets the weather's mix and strength, the temperature and the sea's rise
// (weather/weather.js, weather/sealevel.js), and moves the climate through
// four tiers: Balanced, Unstable, Severe and Crisis.

const N = 16;                         // regions per side
const SIZE = WORLD.size / N;          // 45 m
const AREA = SIZE * SIZE;
const HALF_LIFE = 900;                // s: stripped ground recovers by half in 15 min
const TIPPED = 0.6;                   // stress past which a region starts getting worse by itself
const SPREAD = 3;                     // regions' worth of stress that makes the island's spread 63%
const STEP = 0.5;                     // s between updates

// How much each kind of damage stresses a region. Fire (0.2) and hunting
// (0.1) will join these when the game has them; until then a region's
// stress is scaled to the causes it has, so it can still reach 1.
const WEIGHT = { felling: 0.45, stripping: 0.2, building: 0.05 };
const WEIGHTS = Object.values(WEIGHT).reduce((a, b) => a + b, 0);

// The tiers, with hysteresis: the pressure has to stay past `up` for a
// minute to go up a tier, and below `down` for two to come back down.
// dT: how much warmer (°C) the climate runs.
export const TIERS = [
  { name: 'Balanced', up: 0.3, dT: 0 },
  { name: 'Unstable', up: 0.55, down: 0.22, dT: 1.5 },
  { name: 'Severe', up: 0.8, down: 0.47, dT: 3 },
  { name: 'Crisis', down: 0.7, dT: 5 },
];
const UP_AFTER = 60, DOWN_AFTER = 120;

// How a region is doing, by its stress.
const STATUS = [[0.1, 'healthy'], [0.3, 'strained'], [TIPPED, 'stressed'], [Infinity, 'degrading']];

// A tree's mass of wood: height times trunk cross-section.
const biomass = (t) => t.height * (SPECIES[t.species].trunk * t.s) ** 2;

const COMPASS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];

export class ClimateEntity {
  // terrain, and the vegetation's sources (trees, rocks, bushes) as they stand at the start.
  constructor({ terrain, sources }) {
    this.regions = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x0 = -WORLD.size / 2 + i * SIZE, z0 = -WORLD.size / 2 + j * SIZE;
        // How much of it stands above the sea, and how high.
        let dry = 0, height = 0;
        for (let a = 0; a < 5; a++) {
          for (let b = 0; b < 5; b++) {
            const h = terrain.heightAt(x0 + ((a + 0.5) / 5) * SIZE, z0 + ((b + 0.5) / 5) * SIZE);
            if (h > 0) { dry++; height += h; }
          }
        }
        this.regions.push({
          i, j, x: x0 + SIZE / 2, z: z0 + SIZE / 2, land: dry > 0, coast: dry < 25, height: dry ? height / dry : 0,
          wood0: 0, wood: 0,          // tree biomass at the start, and now
          stone0: 0, plants0: 0,      // stones in its boulders, and gatherings in its bushes
          stripped: 0, eroded: 0, built: 0,
          D: 0, E: 0, U: 0, base: 0, stress: 0,
        });
      }
    }
    for (const t of sources.trees) {
      const r = this.regionAt(t.x, t.z);
      r.wood0 += biomass(t);
      r.wood += biomass(t);
    }
    for (const rock of sources.rocks) this.regionAt(rock.x, rock.z).stone0 += 8;
    for (const bush of sources.bushes) this.regionAt(bush.x, bush.z).plants0 += 3;
    // Land: any region with dry ground or anything growing on it.
    for (const r of this.regions) r.land ||= r.wood0 + r.stone0 + r.plants0 > 0;
    this.land = this.regions.filter((r) => r.land);
    const wooded = this.land.filter((r) => r.wood0 > 0).map((r) => r.wood0).sort((a, b) => a - b);
    const woods = wooded[Math.floor(wooded.length / 2)];
    for (const r of this.land) r.name = regionName(r, woods);

    this.pressure = 0;           // P: the island's stress, 0..1
    this.causes = { felling: 0, stripping: 0, building: 0 };   // how far each has gone, island-wide (0..1)
    this.tier = 0;
    this.dT = 0;                 // warming now (eases towards the tier's)
    this.here = this.regions[0]; // the region you're in
    this.timers = { up: 0, down: 0 };
    this.clock = 0;
    this.onTier = null;          // (tier, previous, cause) when the tier changes
  }

  regionAt(x, z) {
    const i = clamp(Math.floor((x + WORLD.size / 2) / SIZE), 0, N - 1);
    const j = clamp(Math.floor((z + WORLD.size / 2) / SIZE), 0, N - 1);
    return this.regions[i + j * N];
  }

  // Something you did to the island:
  //   { kind: 'fell', tree }           a tree came down
  //   { kind: 'strip', x, z, amount }  bushes or grass cut back (gatherings)
  //   { kind: 'build', x, z, area }    ground built over (m²; negative when taken down)
  record(e) {
    if (e.kind === 'fell') {
      const r = this.regionAt(e.tree.x, e.tree.z);
      r.wood = Math.max(0, r.wood - biomass(e.tree));
    } else if (e.kind === 'strip') {
      this.regionAt(e.x, e.z).stripped += e.amount;
    } else if (e.kind === 'build') {
      const r = this.regionAt(e.x, e.z);
      r.built = Math.max(0, r.built + e.area);
    }
  }

  // What's stressing a region most ('felling', 'stripping' or 'building'), or
  // null if hardly anything is.
  causeOf(r) {
    const parts = { felling: WEIGHT.felling * r.D, stripping: WEIGHT.stripping * r.E, building: WEIGHT.building * r.U };
    const top = Object.keys(parts).reduce((a, b) => (parts[b] > parts[a] ? b : a));
    return parts[top] / WEIGHTS > 0.03 ? top : null;
  }
  statusOf(r) { return STATUS.find(([max]) => r.stress < max)[1]; }

  // What's stressing the island most, or null if hardly anything is.
  get cause() {
    const top = Object.keys(this.causes).reduce((a, b) => (WEIGHT[b] * this.causes[b] > WEIGHT[a] * this.causes[a] ? b : a));
    return this.pressure > 0.05 ? top : null;
  }

  // How much warmer it runs where you are (°C). warm: 0 in cold weather,
  // 1 in warm. As the climate breaks down warm weather gets hotter and
  // cold snaps colder, and cleared land runs hotter (it has lost its shade
  // and holds the heat) and loses it faster on cold days.
  tempOffset(warm) {
    const D = this.here.D;
    return lerp(-0.6 * this.dT - D, this.dT + 4 * D, warm);
  }

  // rain 0..1; (x, z): where you are.
  update(dt, { rain, x, z }) {
    this.here = this.regionAt(x, z);
    if (dt <= 0) return;
    this.dT += (TIERS[this.tier].dT - this.dT) * (1 - Math.exp(-dt / 60));
    if ((this.clock += dt) < STEP) return;
    const step = this.clock;
    this.clock = 0;

    // Each region's stress from what's been done to it.
    for (const r of this.regions) {
      // A tipped region recovers half as fast, and its bare ground washes away in the rain.
      const tipped = r.stress > TIPPED;
      const keep = 0.5 ** (step / (HALF_LIFE * (tipped ? 2 : 1)));
      r.stripped *= keep;
      r.eroded *= keep;
      if (tipped) r.eroded += 0.1 * rain * (step / 60);
      r.D = r.wood0 > 0 ? 1 - r.wood / r.wood0 : 0;
      r.E = Math.min(1, (0.3 * r.stripped) / Math.max(10, r.plants0) + r.eroded);
      r.U = Math.min(1, (10 * r.built) / AREA);
      r.base = clamp((WEIGHT.felling * r.D + WEIGHT.stripping * r.E + WEIGHT.building * r.U) / WEIGHTS, 0, 1);
    }
    // Stress spills over into the regions around.
    for (const r of this.regions) {
      let sum = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i = r.i + di, j = r.j + dj;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        sum += this.regions[i + j * N].base;
        n++;
      }
      r.stress = Math.min(1, r.base + 0.25 * Math.max(0, sum / n - r.base));
    }

    // The island as a whole, which is the climate's pressure: half its
    // worst-hit region (one wrecked valley counts), half how much of it is
    // damaged in all.
    const island = (values) => {
      const total = values.reduce((a, b) => a + b, 0);
      return clamp(0.5 * Math.max(...values) + 0.5 * (1 - Math.exp(-total / SPREAD)), 0, 1);
    };
    this.pressure = island(this.land.map((r) => r.stress));
    for (const cause of Object.keys(this.causes)) {
      const key = { felling: 'D', stripping: 'E', building: 'U' }[cause];
      this.causes[cause] = island(this.land.map((r) => r[key]));
    }

    // Up or down a tier, once the pressure has stayed past the threshold.
    const tier = TIERS[this.tier];
    this.timers.up = tier.up !== undefined && this.pressure >= tier.up ? this.timers.up + step : 0;
    this.timers.down = tier.down !== undefined && this.pressure <= tier.down ? this.timers.down + step : 0;
    const previous = this.tier;
    if (this.timers.up >= UP_AFTER) this.tier++;
    else if (this.timers.down >= DOWN_AFTER) this.tier--;
    if (this.tier !== previous) {
      this.timers.up = this.timers.down = 0;
      this.onTier?.(this.tier, previous, this.cause);
    }
  }
}

// A name you can tell regions apart by: where it lies on the island (north
// is -Z; the noon sun is to the south) and what it's like there. woods:
// the median wooded region's tree biomass.
function regionName(r, woods) {
  const d = Math.hypot(r.x, r.z);
  const where = d < 50 ? 'Central' : COMPASS[Math.round(Math.atan2(r.x, -r.z) / (Math.PI / 4) + 8) % 8];
  const what = r.coast ? 'shore' : r.height > 24 ? 'hills' : r.wood0 >= woods ? 'woods' : 'lowlands';
  return `${where} ${what}`;
}
