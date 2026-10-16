import * as THREE from 'three';
import { SEA, mulberry32, range, smoothstep } from '../shared.js';

// Ocean waves as a bank of Gerstner components. Wavelengths, directions and
// phases are fixed, so nothing ever jumps; only amplitudes change, following
// a wind-driven sea spectrum. On top of that, slow wave-group patterns and
// the occasional rogue set make heights vary from place to place. The same
// maths runs in the water shader (GPU) and for anything that floats (CPU).

const G = 9.81;
const TAU = Math.PI * 2;
const FETCH = 50000;          // metres of open water the wind blows across
const MIN_LENGTH = 1.6, MAX_LENGTH = 90;
const SWELL = [
  { length: 140, angle: -0.08, share: 0.6 },
  { length: 95, angle: 0.12, share: 0.4 },
];

// Wave groups: two slow patterns travelling at the group speed of storm
// waves, so sets of bigger waves roll through with lulls in between.
const GROUPS = [
  { length: 430, angle: SEA.windDir + 0.25 },
  { length: 560, angle: SEA.windDir - 0.4 },
];
const GROUP_SPEED = 4.8;      // m/s, half the phase speed of ~60 m waves
const MAX_GROUP_GAIN = 2.2;   // cap on how much groups and rogues raise waves
const ROGUE_START = 220;      // metres upwind of the player a rogue set appears

// Significant height and peak wavelength of a wind sea: fetch-limited
// JONSWAP growth, capped at a fully developed Pierson-Moskowitz sea.
export function windSea(windSpeed) {
  const u = Math.max(windSpeed, 0.5);
  const hs = Math.min(0.0016 * u * Math.sqrt(FETCH / G), (0.21 * u * u) / G);
  const wp = Math.max(22 * Math.cbrt((G * G) / (u * FETCH)), (0.877 * G) / u);
  return { hs, peak: (TAU * G) / (wp * wp) };
}

// Waves steepen and grow as they feel the bottom, then break and die at the
// shore. Mirrored by shoalFactor() in waterShaders.js.
export function shoalFactor(depth, breakDepth) {
  const grow = 1 + 0.3 * (1 - smoothstep(1.5 * breakDepth, 4 * breakDepth, depth));
  return grow * smoothstep(0, breakDepth, depth);
}

// Pierson-Moskowitz energy per log-frequency band at angular frequency w.
// Its long high-frequency tail is what puts chop on top of big storm waves.
function spectrumWeight(w, wp) {
  const r = wp / w;
  return Math.pow(w, -4) * Math.exp(-1.25 * r * r * r * r);
}

export class Waves {
  constructor(windWaves) {
    const rng = mulberry32(42);
    const parts = [];
    for (let i = 0; i < windWaves; i++) {
      const f = windWaves === 1 ? 0 : i / (windWaves - 1);
      // Neighbouring wavelengths cross at alternating angles, so crests come
      // out short and broken instead of long parallel lines.
      const side = i % 2 ? 1 : -1;
      const spread = 0.35 + 0.75 * (1 - f);
      parts.push({
        length: MIN_LENGTH * Math.pow(MAX_LENGTH / MIN_LENGTH, f) * range(rng, 0.9, 1.1),
        angle: SEA.windDir + side * spread * range(rng, 0.35, 1),
        swell: false,
      });
    }
    for (const s of SWELL) parts.push({ length: s.length, angle: SEA.swellDir + s.angle, swell: true, share: s.share });

    this.list = parts.map((p) => {
      const k = TAU / p.length;
      return {
        ...p, k, omega: Math.sqrt(G * k), dx: Math.cos(p.angle), dz: Math.sin(p.angle),
        phase: rng() * TAU, amp: 0, weight: 0,
      };
    });
    this.count = this.list.length;
    this.groups = GROUPS.map((g) => {
      const k = TAU / g.length;
      return { kx: k * Math.cos(g.angle), kz: k * Math.sin(g.angle), omega: k * GROUP_SPEED, phase: rng() * TAU };
    });
    this.groupStrength = 0;
    this.rogue = { x: 0, z: 0, dx: Math.cos(SEA.windDir), dz: Math.sin(SEA.windDir), strength: 0, peak: 0, active: false };

    this.windSpeed = 2;       // smoothed wave-making wind (m/s)
    this.hs = 0;              // significant wave height (m)
    this.peak = 0;            // peak wavelength of the wind sea (m)
    this.breakDepth = 0.5;    // depth where waves start breaking (m)
    this.steep = 0;
    this.total = 0;
    this.uniformA = this.list.map(() => new THREE.Vector4()); // dirX, dirZ, k, amplitude
    this.uniformB = this.list.map(() => new THREE.Vector4()); // omega, steepness, phase, grouped
  }

  // windSpeed in m/s, choppiness 0..1 sharpens crests, focus is where the
  // player is, severity 0..1 for storms (0 otherwise).
  update(windSpeed, choppiness, dt, focus, severity) {
    // Seas take tens of seconds to build and longer to settle.
    const tau = windSpeed > this.windSpeed ? 20 : 35;
    this.windSpeed += (windSpeed - this.windSpeed) * (1 - Math.exp(-dt / tau));
    const sea = windSea(this.windSpeed);
    const wp = Math.sqrt((TAU * G) / sea.peak);
    const swellHs = 0.2 + 0.03 * this.windSpeed;

    let weights = 0;
    for (const w of this.list) {
      if (w.swell) continue;
      w.weight = spectrumWeight(w.omega, wp);
      weights += w.weight;
    }
    const m0Wind = (sea.hs / 4) ** 2, m0Swell = (swellHs / 4) ** 2;
    let slope = 0;
    this.total = 0;
    for (const w of this.list) {
      w.amp = Math.sqrt(2 * (w.swell ? m0Swell * w.share : (m0Wind * w.weight) / weights));
      slope += w.k * w.amp;
      this.total += w.amp;
    }
    this.hs = Math.hypot(sea.hs, swellHs);
    this.peak = sea.peak;
    this.breakDepth = 0.3 + 0.8 * this.hs;
    // Cap steepness so crests never fold over into loops. Groups only raise
    // heights, never sideways motion, so this cap still holds inside them.
    this.steep = Math.min(choppiness, 0.95 / Math.max(slope, 1e-4));
    // Wave groups: barely there on calm days, distinct sets in a storm.
    this.groupStrength = 0.15 + 0.4 * smoothstep(8, 24, this.windSpeed);
    this.updateRogue(dt, focus, severity);

    this.list.forEach((w, i) => {
      this.uniformA[i].set(w.dx, w.dz, w.k, w.amp);
      this.uniformB[i].set(w.omega, this.steep, w.phase, w.swell ? 0 : 1);
    });
  }

  // Severe storms now and then send through a rogue set: a patch of waves
  // up to twice the usual height, rolling in from upwind.
  updateRogue(dt, focus, severity) {
    const r = this.rogue;
    if (r.active) {
      r.x += r.dx * GROUP_SPEED * dt;
      r.z += r.dz * GROUP_SPEED * dt;
      if ((focus.x - r.x) * r.dx + (focus.z - r.z) * r.dz < -ROGUE_START) r.active = false;
    } else if (severity >= 0.34 && Math.random() < (0.004 + 0.02 * severity) * dt) {
      this.spawnRogue(focus, 0.55 + 0.35 * severity);
    }
    r.strength += ((r.active ? r.peak : 0) - r.strength) * (1 - Math.exp(-dt / 3));
  }

  spawnRogue(focus, peak = 0.9) {
    const r = this.rogue, side = (Math.random() - 0.5) * 120;
    r.x = focus.x - r.dx * ROGUE_START - r.dz * side;
    r.z = focus.z - r.dz * ROGUE_START + r.dx * side;
    r.peak = peak;
    r.active = true;
  }

  // How much taller than normal the wind sea is at (x, z). Mirrored by
  // waveGroups() in waterShaders.js.
  groupGain(x, z, t) {
    let e = 0;
    for (const g of this.groups) e += Math.sin(g.kx * x + g.kz * z - g.omega * t + g.phase);
    let gain = Math.max(1 + this.groupStrength * 0.5 * e, 0.15);
    const r = this.rogue;
    if (r.strength > 0.001) {
      const ox = x - r.x, oz = z - r.z;
      const along = ox * r.dx + oz * r.dz, across = ox * r.dz - oz * r.dx;
      // A patch ~90 m deep (several waves) and ~160 m wide.
      gain *= 1 + r.strength * Math.exp(-(along * along) / 16200 - (across * across) / 51200);
    }
    return Math.min(gain, MAX_GROUP_GAIN);
  }

  // Surface at world (x, z): height offset from sea level, water velocity and
  // slope. Gerstner waves also move water sideways, so first find which
  // undisturbed point ends up at (x, z).
  sample(x, z, t, shoal, out) {
    let bx = x, bz = z;
    for (let it = 0; it < 3; it++) {
      let ox = 0, oz = 0;
      for (const w of this.list) {
        const c = Math.cos(w.k * (w.dx * bx + w.dz * bz) - w.omega * t + w.phase) * this.steep * w.amp * shoal;
        ox += w.dx * c;
        oz += w.dz * c;
      }
      bx = x - ox;
      bz = z - oz;
    }
    const gain = this.groupGain(bx, bz, t);
    let h = 0, vx = 0, vy = 0, vz = 0, sx = 0, sz = 0;
    for (const w of this.list) {
      const th = w.k * (w.dx * bx + w.dz * bz) - w.omega * t + w.phase;
      const s = Math.sin(th), c = Math.cos(th), a = w.amp * shoal * (w.swell ? 1 : gain);
      h += a * s;
      vy -= a * w.omega * c;
      vx += a * w.omega * w.dx * s;
      vz += a * w.omega * w.dz * s;
      sx += a * w.k * w.dx * c;
      sz += a * w.k * w.dz * c;
    }
    out.height = h;
    out.vx = vx; out.vy = vy; out.vz = vz;
    out.slopeX = sx; out.slopeZ = sz;
    return out;
  }
}
