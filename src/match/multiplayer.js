import { connect } from '../net/net.js';
import { LobbyUI } from '../ui/lobbyUI.js';
import { TEAMS } from './teams.js';
import { findBases } from './bases.js';
import { Barriers } from './barriers.js';
import { BedWars } from './bedwars.js';

const NAME_KEY = 'washed-away.name';

// Milliseconds as m:ss, rounded up (so 0:00 is the end), and as words.
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const span = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 90 ? `${Math.round(s / 60)} minutes` : s >= 60 ? 'minute' : `${s} seconds`;
};

// Multiplayer, when the address has ?mp. The game server decides the island
// (its seed), so this connects before the island is generated. Returns
// { net, seed }, or { error } if no server answered.
export async function joinServer() {
  try {
    const net = await connect();
    return { net, seed: net.welcome.seed };
  } catch (error) {
    return { error };
  }
}

// The start screen becomes the lobby until the host starts the match; then
// everyone spawns at their team's base, next to its bed. The match opens
// with the server's build phase: a countdown, and barriers that keep each
// team out of the others' bases until it ends. Then it's bed wars
// (bedwars.js) until one team is left. overlay: the start screen. Returns
// { inLobby, intro, team, bases, barriersUp, fighting, strike, update(dt) }:
// while inLobby, clicking the start screen doesn't start the game.
export function createMatch({ net, seed, error }, { terrain, player, hud, overlay, scene, sea, camera }) {
  overlay.classList.add('mp', 'lobby');
  const leave = () => { location.href = location.pathname; };
  let name = '';
  try { name = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* storage blocked */ }
  let joined = false;   // asked to join, so ask again after a reconnect
  let team = null;      // ours, once the match is on
  let bases = null;     // every team's, once the match is on
  let barriers = null;
  let wars = null;      // the fighting, once the match is on
  let buildEnds = 0;    // when the build phase ends (performance.now() time), while it lasts
  let warned = false, bumped = -Infinity, hideTimer = 0;
  const timer = document.getElementById('match-timer');

  // The build phase is over (the server says so): the barriers come down.
  const open = () => {
    if (!buildEnds) return;
    buildEnds = 0;
    barriers.open();
    wars.peace = false;
    hud.message('The barriers are down: every base is open. Guard your bed!', 8);
    timer.textContent = 'Barriers down · every base is open';
    timer.className = 'open';
    hideTimer = performance.now() + 6000;
  };
  // Running into another team's barrier.
  const keepOut = (pos, vel) => {
    const hit = barriers?.keepOut(pos, vel) ?? -1;
    if (hit < 0 || performance.now() - bumped < 4000) return;
    bumped = performance.now();
    hud.message(`Team ${TEAMS[hit].name}’s base is closed until the barriers come down (${clock(buildEnds - bumped)}).`, 3);
  };

  const ui = new LobbyUI(overlay.querySelector('#lobby'), {
    name,
    onJoin(chosen) {
      name = chosen;
      try { localStorage.setItem(NAME_KEY, name); } catch { /* storage blocked */ }
      joined = true;
      net.send('join', name);
    },
    onTeam: (index) => net.send('team', index),
    onReady: (ready) => net.send('ready', ready),
    onStart: () => net.send('start'),
    onLeave: leave,
  });
  const match = {
    get inLobby() { return overlay.classList.contains('lobby'); },
    get intro() {
      if (!team) return null;
      const where = `You’re on Team ${team.name}, on the ${team.shore} shore.`;
      const left = buildEnds - performance.now();
      return buildEnds && left > 1000 ? `${where} For the next ${span(left)}, barriers keep the other teams out of every base: build while you can.` : where;
    },
    get team() { return team; },
    get bases() { return bases; },
    get barriersUp() { return !!barriers?.up; },
    // Up and about in the match, so a swing can hit someone.
    get fighting() { return !!wars?.fighting; },
    // A swing landing (ray: from your eye; tool: what's in your hand, or
    // 'none'). Returns true if it hit another team's player or bed.
    strike: (ray, tool) => wars?.strike(ray, tool) ?? false,

    // Every frame: the fighting, the barriers, and the countdown at the top
    // of the screen.
    update(dt) {
      wars?.update(dt);
      barriers?.update(dt);
      const now = performance.now();
      if (hideTimer && now > hideTimer) {
        hideTimer = 0;
        timer.hidden = true;
      }
      if (!buildEnds) return;
      const left = buildEnds - now;
      timer.textContent = `Build phase · barriers down in ${clock(left)}`;
      timer.classList.toggle('soon', left < 60000);
      if (!warned && left < 60000) {
        warned = true;
        hud.message('One minute until the barriers come down.', 5);
      }
      if (left < -3000) open();   // in case the server's word went missing
    },
  };
  if (error) {
    ui.offline(`No game server answered at ${location.host}. Start one with npm run server, then try again.`, () => location.reload());
    return match;
  }

  net.on('lobby', (state) => {
    if (!team) ui.render(state, net.id);
    else wars?.left(state.players);
  });
  net.on('notice', (text) => ui.notice(text));
  net.on('start', ({ players, buildLeft = 0 }) => {
    const me = players.find((p) => p.id === net.id);
    if (!me) return;   // it started without us
    team = TEAMS[me.team];
    bases = findBases(terrain);
    player.spawn = bases[me.team];
    player.respawn();
    overlay.classList.remove('lobby');
    ui.showMatch(team, players);
    wars = new BedWars({ net, players, me: net.id, bases, terrain, scene, player, camera, hud, peace: buildLeft > 0 });
    if (buildLeft > 0) {
      buildEnds = performance.now() + buildLeft;
      warned = buildLeft <= 60000;   // no warning for a phase shorter than that
      barriers = new Barriers(scene, terrain, bases, me.team, sea.level);
      player.keepOut = keepOut;
      timer.className = '';
      timer.hidden = false;
    }
  });
  net.on('basesOpen', open);
  // After a reconnect the server says hello again.
  net.on('welcome', (hello) => {
    if (hello.seed !== seed) location.reload();   // it restarted with another island
    else if (team) hud.message('Back in touch with the game server.', 4);
    else if (joined) net.send('join', name);
  });
  net.on('connect', () => { if (!team) ui.notice('Reconnected.', 2); });
  const lost = () => {
    if (team) hud.message('Lost touch with the game server. Trying to reconnect…', 5);
    else ui.notice('Lost touch with the game server. Trying to reconnect…', 60);
  };
  net.on('disconnect', lost);
  // It may have dropped while the island was being generated.
  if (!net.connected) lost();
  return match;
}
