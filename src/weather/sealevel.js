import { uniforms, clamp, smoothstep } from '../shared.js';

// Sea level is the sum of three parts:
// - rise:  the long-term climb as the swelling sun warms the planet,
//          speeding up as the climate breaks down (up to MAX_RISE);
// - tide:  two high tides a day;
// - surge: storms pile water against the shore. Worse storms push harder;
//          a surge builds over about a minute and drains away more slowly.
//
// The sea level moves the water (rendering and physics) and floods the
// beaches. Salt water leaves its mark: grass it reaches dies back and the
// ground browns (both recover slowly once it retreats), and trees and
// bushes whose roots it reaches die for good.
//
// For structures: exposure() says how the sea reaches a point, and
// durabilityLoss() turns that into wear, so anything built near the shore
// breaks down as the sea climbs and the storms get worse.

export const MAX_RISE = 2.4;   // metres, by the end of the climate ramp
const TIDE = 0.35;             // metres either side of the mean
const SURGE = [0.3, 1.4];      // metres, from a thunderstorm to a violent storm

export class SeaLevel {
  constructor(water) {
    this.water = water;
    this.rise = 0;
    this.tide = 0;
    this.surge = 0;
    this.level = 0;        // rise + tide + surge, metres above the starting sea level
    this.rate = 0;         // metres per second (positive while the water is coming up)
    this.tideRate = 0;     // metres per second, the tide alone
    this.saltLine = 0;     // ground plants below this are dead (drops back slowly)
    this.killLine = 0;     // highest the water has ever reached: trees below are dead
    this.surging = false;
    this.onSurge = null;   // called when a storm surge starts coming in
    this._s = {};
    this._e = {};
  }

  // dt in seconds (0 while paused), dayTime 0..1 from midnight.
  update(dt, weather, dayTime) {
    const i = weather.instability;
    this.rise = MAX_RISE * (0.6 * i + 0.4 * i * i);
    const tide = TIDE * Math.sin(dayTime * Math.PI * 4);
    if (dt > 0) this.tideRate = (tide - this.tide) / dt;
    this.tide = tide;
    const storm = weather.key === 'storm' ? SURGE[0] + (SURGE[1] - SURGE[0]) * weather.severity : 0;
    const target = storm * smoothstep(0.35, 0.9, weather.current.wind);
    if (dt > 0) this.surge += (target - this.surge) * (1 - Math.exp(-dt / (target > this.surge ? 50 : 140)));
    const level = this.rise + this.tide + this.surge;
    if (dt > 0) this.rate = (level - this.level) / dt;
    this.level = level;

    // Salt marks the highest water, then fades back as plants recover
    // (about a metre in fifteen minutes). Dead trees stay dead.
    this.saltLine = Math.max(level + 0.1, this.saltLine - dt / 900);
    this.killLine = Math.max(this.killLine, level);

    const surging = this.surge > 0.35;
    if (surging && !this.surging) this.onSurge?.(this.surge);
    this.surging = surging;

    uniforms.uWaterLevel.value = level;
    uniforms.uSaltLine.value = this.saltLine;
    uniforms.uTreeKillLine.value = this.killLine;
  }

  // How the sea reaches something at (x, z) whose lowest point is at height y:
  //   depth      water above y right now, waves included (m; negative when dry)
  //   submerged  0..1, how far under (1 from a metre deep)
  //   splash     0..1, how much the surf reaches it (1 at the waterline,
  //              0 above the run-up of the biggest waves)
  //   salt       0..1, salt spray (1 at the waterline, 0 three metres up)
  exposure(x, z, y, t = uniforms.uTime.value, out = {}) {
    const s = this.water.surface(x, z, t, this._s);
    const runUp = Math.max(0.3, this.water.waves.hs);
    out.depth = s.height - y;
    out.submerged = clamp(out.depth, 0, 1);
    out.splash = clamp((this.level + runUp - y) / runUp, 0, 1);
    out.salt = clamp(1 - (y - this.level) / 3, 0, 1);
    return out;
  }

  // Durability lost per second, as a fraction of full durability, by a
  // structure at (x, z) whose lowest point is at height y. resistance is 1
  // for wood; sturdier materials last longer (stone ~4). For wood: about
  // three minutes a metre under water, fifteen minutes in the surf, a couple
  // of hours in salt spray. Rough seas hit harder.
  durabilityLoss(x, z, y, t = uniforms.uTime.value, resistance = 1) {
    const e = this.exposure(x, z, y, t, this._e);
    const rough = 1 + 0.5 * this.water.waves.hs;
    const underwater = e.depth > 0 ? 0.0055 * (0.3 + 0.7 * e.submerged) * rough : 0;
    return (underwater + 0.0011 * e.splash * rough + 0.00012 * e.salt) / resistance;
  }
}
