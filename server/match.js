import { BED_HP, REACH, SWING_GAP, damageOf } from '../src/match/rules.js';

const TOOLS = new Set(['knife', 'axe', 'pickaxe']);
const tool = (t) => (TOOLS.has(t) ? t : 'none');
const SLACK = 1.5;   // metres of reach allowed for lag

// A bed-wars match on the server: where everyone is, who's down or out,
// and the beds (see src/match/rules.js). It checks every hit against what
// it knows: both alive, on different teams, within reach, not too often.
// Health is kept by each player's game; the server says who was hit and
// how hard, and hears when someone goes down.
export class Match {
  // players: the lobby's ([{ id, name, team }]).
  constructor(players) {
    this.players = new Map(players.map((p) => [p.id, {
      id: p.id, name: p.name, team: p.team,
      alive: true, out: false, pos: null, lastSwing: 0, hurtBy: null, hurtAt: 0,
    }]));
    this.teams = [...new Set(players.map((p) => p.team))];
    this.beds = new Map(this.teams.map((team) => [team, BED_HP]));   // health of each standing bed
    this.bedAt = null;   // where the beds are ({ x, z } by team), from the first game to say
  }

  // Where a player is: [x, y, z, yaw, speed], 20 times a second.
  move(id, state) {
    const p = this.players.get(id);
    if (!p?.alive || !Array.isArray(state) || state.length !== 5 || !state.every(Number.isFinite)) return;
    p.pos = state;
  }

  // Everyone up and about, for the others' games: { id: [x, y, z, yaw, speed] }.
  snapshot() {
    const out = {};
    for (const p of this.players.values()) if (p.alive && p.pos) out[p.id] = p.pos;
    return out;
  }

  setBeds(beds) {
    if (this.bedAt || !Array.isArray(beds)) return;
    this.bedAt = beds.map((b) => (b && Number.isFinite(b.x) && Number.isFinite(b.z) ? { x: b.x, z: b.z } : null));
  }

  // A swing at another player: how hard it hit, or null if it doesn't count.
  hit(id, targetId, held, now) {
    const a = this.players.get(id), b = this.players.get(targetId);
    if (!a || !b || a === b || a.team === b.team || !a.alive || !b.alive || !a.pos || !b.pos) return null;
    if (now - a.lastSwing < SWING_GAP) return null;
    if (Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) > REACH + SLACK || Math.abs(a.pos[1] - b.pos[1]) > 3) return null;
    a.lastSwing = now;
    b.hurtBy = a.id;
    b.hurtAt = now;
    return { amount: damageOf('player', tool(held)), by: a.name, from: [a.pos[0], a.pos[2]] };
  }

  // A swing at another team's bed: its health now, and whether that broke it.
  hitBed(id, team, held, now) {
    const a = this.players.get(id), hp = this.beds.get(team);
    if (!a?.alive || !a.pos || a.team === team || !(hp > 0)) return null;
    if (now - a.lastSwing < SWING_GAP) return null;
    const at = this.bedAt?.[team];
    if (at && Math.hypot(a.pos[0] - at.x, a.pos[2] - at.z) > REACH + SLACK + 1.5) return null;
    a.lastSwing = now;
    const left = Math.max(0, hp - damageOf('bed', tool(held)));
    this.beds.set(team, left);
    return { hp: left, destroyed: left === 0, by: a.name };
  }

  // A player went down: knocked out (by whoever hit them last, within ten
  // seconds) or drowned. Out for good if their team's bed is gone.
  died(id, now) {
    const p = this.players.get(id);
    if (!p?.alive) return null;
    p.alive = false;
    p.pos = null;
    p.out = !(this.beds.get(p.team) > 0);
    const by = now - p.hurtAt < 10000 ? this.players.get(p.hurtBy)?.name ?? null : null;
    return { name: p.name, team: p.team, by, out: p.out };
  }

  // Back at their bed (if they're still in it).
  respawn(id) {
    const p = this.players.get(id);
    if (!p || p.out) return false;
    p.alive = true;
    return true;
  }

  leave(id) { this.players.delete(id); }

  // Over once only one team has anyone left in it (if it began with more
  // than one): { winner } (its index, or -1 if nobody's left), else null.
  result() {
    if (this.teams.length < 2) return null;
    const left = new Set([...this.players.values()].filter((p) => !p.out).map((p) => p.team));
    return left.size > 1 ? null : { winner: left.size ? [...left][0] : -1 };
  }
}
