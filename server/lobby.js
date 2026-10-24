import { TEAMS, TEAM_SIZE, NAME_LENGTH, BUILD_TIME } from '../src/match/teams.js';

// The lobby: who's in, on which team, who's ready, and who hosts (the first
// to join, then the next in line when they leave). The host starts the
// match once everyone is ready, and it opens with a build phase of
// buildTime seconds, while barriers keep each team out of the others'
// bases. There's one match at a time: once everyone has left it, the lobby
// opens again.
// Each change returns an error to show the player who asked, or null, and
// counts up `version` if it changed anything (so only real changes go out).
export class Lobby {
  constructor(seed, buildTime = BUILD_TIME) {
    this.seed = seed;
    this.buildTime = buildTime;
    this.phase = 'lobby';         // or 'playing', once the match has started
    this.buildEnds = 0;           // when the build phase ends (Date.now() time)
    this.players = new Map();     // by socket id, in the order they joined: { id, name, team, ready }
    this.version = 0;
  }

  get host() { return this.players.keys().next().value ?? null; }

  // Milliseconds of the build phase left (0 once the bases are open, or
  // outside a match).
  get buildLeft() { return this.phase === 'playing' ? Math.max(0, this.buildEnds - Date.now()) : 0; }

  get state() {
    return { phase: this.phase, seed: this.seed, host: this.host, players: [...this.players.values()], buildLeft: this.buildLeft };
  }

  // How many players each team has.
  counts() {
    const counts = TEAMS.map(() => 0);
    for (const p of this.players.values()) counts[p.team]++;
    return counts;
  }

  // Joining puts you on the team with the fewest players.
  join(id, name) {
    if (this.phase !== 'lobby') return 'A match is under way. You can join the next one.';
    if (this.players.has(id)) return null;
    if (this.players.size >= TEAMS.length * TEAM_SIZE) return 'The lobby is full.';
    const counts = this.counts();
    const team = counts.indexOf(Math.min(...counts));
    this.players.set(id, { id, name: cleanName(name, `Player ${this.players.size + 1}`), team, ready: false });
    this.version++;
    return null;
  }

  // Switching teams takes back your ready.
  setTeam(id, team) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby' || !Number.isInteger(team) || !TEAMS[team] || team === p.team) return null;
    if (this.counts()[team] >= TEAM_SIZE) return `Team ${TEAMS[team].name} is full.`;
    p.team = team;
    p.ready = false;
    this.version++;
    return null;
  }

  setReady(id, ready) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby' || p.ready === (ready === true)) return null;
    p.ready = ready === true;
    this.version++;
    return null;
  }

  start(id) {
    if (this.phase !== 'lobby') return 'The match has already started.';
    if (id !== this.host) return 'Only the host can start the match.';
    if (![...this.players.values()].every((p) => p.ready)) return 'Everyone has to be ready first.';
    this.phase = 'playing';
    this.buildEnds = Date.now() + this.buildTime * 1000;
    this.version++;
    return null;
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    if (!this.players.size) this.phase = 'lobby';
    this.version++;
  }

  // The match is over: the lobby opens again, empty, and everyone joins
  // afresh (their games reload, so the island starts over untouched).
  reset() {
    this.phase = 'lobby';
    this.buildEnds = 0;
    this.players.clear();
    this.version++;
  }
}

// A name to show other players: no control or invisible characters, trimmed,
// and not too long. Anything else gets the fallback.
function cleanName(name, fallback) {
  const chars = [...String(name ?? '').replace(/\p{C}/gu, '').trim()];   // whole characters, emoji included
  return chars.slice(0, NAME_LENGTH).join('').trim() || fallback;
}
