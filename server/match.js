import { BED_HP, REACH, SWING_GAP, PLACE_REACH, damageOf } from '../src/match/rules.js';
import { TEAMS, BASE_RADIUS, KEEP_OUT } from '../src/match/teams.js';

const TOOLS = new Set(['knife', 'axe', 'pickaxe']);
const tool = (t) => (TOOLS.has(t) ? t : 'none');
const SLACK = 1.5;   // metres of reach allowed for lag
const spot = (b) => (b && Number.isFinite(b.x) && Number.isFinite(b.z) ? { x: b.x, z: b.z, yaw: Number.isFinite(b.yaw) ? b.yaw : null } : null);

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
    this.placed = new Map();   // where each team's bed was put down: { team, x, y, z, yaw, by }
    this.bedAt = null;   // where each team's bed goes if nobody places it ({ x, z, yaw } by team), from the first game to say
    this.bases = null;   // every team's base ({ x, z }), from the first game to say
  }

  // Whose base (any team's but `team`) (x, z) is within `radius` of, or -1.
  inBase(x, z, team, radius) {
    return this.bases?.findIndex((b, i) => i !== team && b && Math.hypot(x - b.x, z - b.z) < radius) ?? -1;
  }

  // Where a player is: [x, y, z, yaw, speed], 20 times a second. While the
  // barriers are up (closed), a place inside another team's base doesn't
  // count: nobody gets in until they come down.
  move(id, state, closed = false) {
    const p = this.players.get(id);
    if (!p?.alive || !Array.isArray(state) || state.length !== 5 || !state.every(Number.isFinite)) return;
    if (closed && this.inBase(state[0], state[2], p.team, KEEP_OUT - 0.5) >= 0) return;
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
    this.bedAt = beds.map(spot);
  }

  setBases(bases) {
    if (this.bases || !Array.isArray(bases)) return;
    this.bases = bases.map(spot);
  }

  // A player puts down their team's bed ({ x, y, z, yaw }): { bed } for
  // everyone, or { error } to tell them why not. It goes anywhere outside the
  // other teams' bases, within reach of whoever places it, once per team.
  placeBed(id, where) {
    const p = this.players.get(id);
    if (!p?.alive || p.out) return { error: 'You can’t place the bed right now.' };
    if (this.placed.has(p.team)) return { error: 'Your team’s bed is already placed.' };
    if (!(this.beds.get(p.team) > 0)) return { error: 'Your team’s bed is gone.' };
    const { x, y, z, yaw } = where ?? {};
    if (![x, y, z, yaw].every(Number.isFinite)) return { error: 'The bed can’t go there.' };
    if (p.pos && Math.hypot(p.pos[0] - x, p.pos[2] - z) > PLACE_REACH + SLACK) return { error: 'That’s too far away to place the bed.' };
    const other = this.inBase(x, z, p.team, BASE_RADIUS + 1);
    if (other >= 0) return { error: `The bed can’t go in Team ${TEAMS[other].name}’s base.` };
    const bed = { team: p.team, x, y, z, yaw, by: p.name };
    this.placed.set(p.team, bed);
    return { bed };
  }

  // The barriers came down: every bed nobody placed goes down at its team's
  // base, where it would have stood. Returns those beds ({ team, x, y: null,
  // z, yaw, auto: true }: each game finds the ground under it).
  autoPlace() {
    const beds = [];
    for (const [team, hp] of this.beds) {
      const at = this.bedAt?.[team];
      if (!(hp > 0) || this.placed.has(team) || !at) continue;
      const bed = { team, x: at.x, y: null, z: at.z, yaw: at.yaw, auto: true };
      this.placed.set(team, bed);
      beds.push(bed);
    }
    return beds;
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

  // A swing at something another team built (the games check whose it is
  // and where): the swinger's name, or null if it doesn't count.
  swing(id, now) {
    const a = this.players.get(id);
    if (!a?.alive || now - a.lastSwing < SWING_GAP) return null;
    a.lastSwing = now;
    return a.name;
  }

  // A swing at another team's bed (only once it's been placed): its health
  // now, and whether that broke it.
  hitBed(id, team, held, now) {
    const a = this.players.get(id), hp = this.beds.get(team), at = this.placed.get(team);
    if (!a?.alive || !a.pos || a.team === team || !(hp > 0) || !at) return null;
    if (now - a.lastSwing < SWING_GAP) return null;
    if (Math.hypot(a.pos[0] - at.x, a.pos[2] - at.z) > REACH + SLACK + 1.5) return null;
    a.lastSwing = now;
    const left = Math.max(0, hp - damageOf('bed', tool(held)));
    this.beds.set(team, left);
    return { hp: left, destroyed: left === 0, by: a.name };
  }

  // A player went down: knocked out (by whoever hit them last, within ten
  // seconds) or drowned. Out for good if their team's bed is gone (a bed
  // not placed yet still counts).
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

  // The storm surge washes away every bed still standing. Returns their teams.
  surge() {
    const washed = [...this.beds].filter(([, hp]) => hp > 0).map(([team]) => team);
    for (const team of washed) this.beds.set(team, 0);
    return washed;
  }

  // Time's up: the team with the most players still in wins, and a tie is
  // a draw: { winner (-1 for a draw), time: true }.
  timeUp() {
    const left = new Map();
    for (const p of this.players.values()) if (!p.out) left.set(p.team, (left.get(p.team) ?? 0) + 1);
    const most = Math.max(0, ...left.values());
    const leaders = [...left].filter(([, n]) => n === most);
    return { winner: most > 0 && leaders.length === 1 ? leaders[0][0] : -1, time: true };
  }

  // Over once only one team has anyone left in it (if it began with more
  // than one): { winner } (its index, or -1 if nobody's left), else null.
  result() {
    if (this.teams.length < 2) return null;
    const left = new Set([...this.players.values()].filter((p) => !p.out).map((p) => p.team));
    return left.size > 1 ? null : { winner: left.size ? [...left][0] : -1 };
  }
}
