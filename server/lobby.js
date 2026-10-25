import { TEAMS, TEAM_SIZE, NAME_LENGTH, BUILD_TIME, WATCH, MAX_WATCHING } from '../src/match/teams.js';

// The lobby: who's in, on which team, who's ready, and who hosts (the first
// to join, then the next in line when they leave). Anyone can watch
// instead of playing (team WATCH): spectators don't need to be ready. The
// host starts the match once every player is ready, and it opens with a build phase of
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

  // How many players each team has (spectators aside).
  counts() {
    const counts = TEAMS.map(() => 0);
    for (const p of this.players.values()) if (p.team !== WATCH) counts[p.team]++;
    return counts;
  }

  get watching() { return [...this.players.values()].filter((p) => p.team === WATCH).length; }

  // Joining puts you on the team with the fewest players, or once every
  // team is full, with the spectators.
  join(id, name) {
    if (this.phase !== 'lobby') return 'A match is under way. You can join the next one.';
    if (this.players.has(id)) return null;
    const counts = this.counts();
    const fewest = Math.min(...counts);
    if (fewest >= TEAM_SIZE && this.watching >= MAX_WATCHING) return 'The lobby is full.';
    const team = fewest < TEAM_SIZE ? counts.indexOf(fewest) : WATCH;
    this.players.set(id, { id, name: cleanName(name, `Player ${this.players.size + 1}`), team, ready: false });
    this.version++;
    return null;
  }

  // Switching teams (or to watching) takes back your ready.
  setTeam(id, team) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby' || !Number.isInteger(team) || !(TEAMS[team] || team === WATCH) || team === p.team) return null;
    if (team === WATCH && this.watching >= MAX_WATCHING) return 'There are as many spectators as there can be.';
    if (team !== WATCH && this.counts()[team] >= TEAM_SIZE) return `Team ${TEAMS[team].name} is full.`;
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
    const playing = [...this.players.values()].filter((p) => p.team !== WATCH);
    if (!playing.length) return 'Someone has to play: pick a team.';
    if (!playing.every((p) => p.ready)) return 'Every player has to be ready first.';
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
