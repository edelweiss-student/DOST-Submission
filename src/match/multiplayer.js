import { connect } from '../net/net.js';
import { LobbyUI } from '../ui/lobbyUI.js';
import { TEAMS } from './teams.js';
import { findBases } from './bases.js';

const NAME_KEY = 'borrowed-time.name';

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
// everyone spawns at their team's base (and comes back there after blacking
// out). overlay: the start screen. Returns { inLobby, intro, team }: while
// inLobby, clicking the start screen doesn't start the game.
export function createMatch({ net, seed, error }, { terrain, player, hud, overlay }) {
  overlay.classList.add('mp', 'lobby');
  const leave = () => { location.href = location.pathname; };
  let name = '';
  try { name = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* storage blocked */ }
  let joined = false;   // asked to join, so ask again after a reconnect
  let team = null;      // ours, once the match is on

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
    get intro() { return team && `You’re on Team ${team.name}. Your base is on the ${team.shore} shore.`; },
    get team() { return team; },
  };
  if (error) {
    ui.offline(`No game server answered at ${location.host}. Start one with npm run server, then try again.`, () => location.reload());
    return match;
  }

  net.on('lobby', (state) => { if (!team) ui.render(state, net.id); });
  net.on('notice', (text) => ui.notice(text));
  net.on('start', ({ players }) => {
    const me = players.find((p) => p.id === net.id);
    if (!me) return;   // it started without us
    team = TEAMS[me.team];
    player.spawn = findBases(terrain)[me.team];
    player.respawn();
    overlay.classList.remove('lobby');
    ui.showMatch(team, players);
  });
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
