import { BED_HP, REACH, SWING_GAP, PLACE_REACH, KUBO_REACH, SPEAR, damageOf, spearDamage } from '../src/match/rules.js';
import { TEAMS, BASE_RADIUS, KEEP_OUT } from '../src/match/teams.js';

const TOOLS = new Set(['knife', 'axe', 'pickaxe', 'spear']);
const tool = (t) => (TOOLS.has(t) ? t : 'none');
const SLACK = 1.5;   // metres of reach allowed for lag
const CELL = 2;      // the building grid (world/building.js): a bahay kubo is 2 × 2 cells
const spot = (b) => (b && Number.isFinite(b.x) && Number.isFinite(b.z) ? { x: b.x, z: b.z, yaw: Number.isFinite(b.yaw) ? b.yaw : null } : null);
// A bahay kubo's place: its cells' corner (i0, j0), which side its door faces, its deck's height.
const kuboSpot = (k) => (k && [k.i0, k.j0, k.turn].every(Number.isInteger) && k.turn >= 0 && k.turn < 4 && Number.isFinite(k.deck)
  ? { i0: k.i0, j0: k.j0, turn: k.turn, deck: k.deck } : null);
// A bed in a bahay kubo lies in the middle, its head away from the door.
const KUBO_BED_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

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
      thrown: null,   // their last spear: { at, from: [x, y, z], charge, hit }
    }]));
    this.teams = [...new Set(players.map((p) => p.team))];
    this.beds = new Map(this.teams.map((team) => [team, BED_HP]));   // health of each standing bed
    this.placed = new Map();   // where each team's bed was put down: { team, x, y, z, yaw, by }
    this.bedAt = null;   // where each team's bed goes if nobody places it ({ x, z, yaw } by team), from the first game to say
    this.bases = null;   // every team's base ({ x, z }), from the first game to say
    this.kubos = new Map();   // where each team's bahay kubo went up: { team, i0, j0, turn, deck, by }
    this.kuboAt = null;  // where each goes up if nobody puts it up, from the first game to say
  }

  // Whose base (any team's but `team`) (x, z) is within `radius` of, or -1.
  inBase(x, z, team, radius) {
    return this.bases?.findIndex((b, i) => i !== team && b && Math.hypot(x - b.x, z - b.z) < radius) ?? -1;
  }

  // Where a player is: [x, y, z, yaw, speed, held, acts] (what's in their
  // hand and how many swings so far, for the others to see), 20 times a
  // second. While the barriers are up (closed), a place inside another
  // team's base doesn't count: nobody gets in until they come down.
  move(id, state, closed = false) {
    const p = this.players.get(id);
    if (!p?.alive || !Array.isArray(state) || state.length < 5 || state.length > 7 || !state.every(Number.isFinite)) return;
    if (closed && this.inBase(state[0], state[2], p.team, KEEP_OUT - 0.5) >= 0) return;
    p.pos = state;
  }

  // Everyone up and about, for the others' games: { id: [x, y, z, yaw, speed, held, acts] }.
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

  // The barriers came down: every bed nobody placed goes down in its team's
  // bahay kubo, or else at its base, where it would have stood. Returns
  // those beds ({ team, x, y, z, yaw, auto: true }; y null: each game finds
  // the ground under it).
  autoPlace() {
    const beds = [];
    for (const [team, hp] of this.beds) {
      const at = this.bedAt?.[team], kubo = this.kubos.get(team);
      if (!(hp > 0) || this.placed.has(team) || !(at || kubo)) continue;
      const bed = kubo
        ? { team, x: (kubo.i0 + 1) * CELL, y: kubo.deck, z: (kubo.j0 + 1) * CELL, yaw: KUBO_BED_YAW[kubo.turn], auto: true }
        : { team, x: at.x, y: null, z: at.z, yaw: at.yaw, auto: true };
      this.placed.set(team, bed);
      beds.push(bed);
    }
    return beds;
  }

  setKubos(list) {
    if (this.kuboAt || !Array.isArray(list)) return;
    this.kuboAt = list.map(kuboSpot);
  }

  // A player puts up their team's bahay kubo ({ i0, j0, turn, deck }):
  // { kubo } for everyone, or { error }. Once per team, within reach,
  // outside the other teams' bases.
  placeKubo(id, where) {
    const p = this.players.get(id);
    if (!p?.alive || p.out) return { error: 'You can’t put up the bahay kubo right now.' };
    if (this.kubos.has(p.team)) return { error: 'Your team’s bahay kubo is already up.' };
    const at = kuboSpot(where);
    if (!at) return { error: 'The bahay kubo can’t go there.' };
    const x = (at.i0 + 1) * CELL, z = (at.j0 + 1) * CELL;
    if (p.pos && Math.hypot(p.pos[0] - x, p.pos[2] - z) > KUBO_REACH + SLACK) return { error: 'That’s too far away to put up the bahay kubo.' };
    const other = this.inBase(x, z, p.team, BASE_RADIUS + 3);
    if (other >= 0) return { error: `The bahay kubo can’t go in Team ${TEAMS[other].name}’s base.` };
    const kubo = { team: p.team, ...at, by: p.name };
    this.kubos.set(p.team, kubo);
    return { kubo };
  }

  // The barriers came down: every bahay kubo nobody put up goes up near its
  // team's base. Returns them ({ team, i0, j0, turn, deck, auto: true }).
  autoPlaceKubos() {
    const kubos = [];
    for (const team of this.teams) {
      const at = this.kuboAt?.[team];
      if (this.kubos.has(team) || !at) continue;
      const kubo = { team, ...at, auto: true };
      this.kubos.set(team, kubo);
      kubos.push(kubo);
    }
    return kubos;
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

  // A spear thrown from `from` ([x, y, z], near where the thrower is),
  // drawn back `charge` (0..1): kept for the one hit it may make. True if it
  // counts (alive, not too soon after the last).
  throwSpear(id, from, charge, now) {
    const a = this.players.get(id);
    if (!a?.alive || !a.pos || !Array.isArray(from) || from.length !== 3 || !from.every(Number.isFinite)) return false;
    if (Math.hypot(from[0] - a.pos[0], from[2] - a.pos[2]) > 4 || (a.thrown && now - a.thrown.at < SPEAR.gap)) return false;
    a.thrown = { at: now, from, charge: Math.min(1, Math.max(0, Number(charge) || 0)), hit: false };
    return true;
  }

  // That spear hit another player (as its thrower's game saw it): how hard,
  // or null if it doesn't count: one hit a throw, within a few seconds of
  // it, another team's, within the spear's range.
  spearHit(id, targetId, now) {
    const a = this.players.get(id), b = this.players.get(targetId), t = a?.thrown;
    if (!t || t.hit || now - t.at > 5000 || !b || b === a || a.team === b.team || !b.alive || !b.pos) return null;
    if (Math.hypot(t.from[0] - b.pos[0], t.from[2] - b.pos[2]) > SPEAR.range) return null;
    t.hit = true;
    b.hurtBy = a.id;
    b.hurtAt = now;
    return { amount: spearDamage(t.charge), by: a.name, from: [t.from[0], t.from[2]] };
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

  // The flood reached a team's bed (a game saw the water over it): it's
  // washed away. True if that took a standing bed.
  flood(team) {
    if (!(this.beds.get(team) > 0) || !this.placed.has(team)) return false;
    this.beds.set(team, 0);
    return true;
  }

  // Over once only one team has anyone left in it (if it began with more
  // than one): { winner } (its index, or -1 if nobody's left), else null.
  result() {
    if (this.teams.length < 2) return null;
    const left = new Set([...this.players.values()].filter((p) => !p.out).map((p) => p.team));
    return left.size > 1 ? null : { winner: left.size ? [...left][0] : -1 };
  }
}
