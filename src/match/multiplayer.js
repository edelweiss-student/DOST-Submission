import { connect } from '../net/net.js';
import { LobbyUI } from '../ui/lobbyUI.js';
import { TEAMS, BASE_RADIUS, WATCH } from './teams.js';
import { findBases } from './bases.js';
import { Barriers } from './barriers.js';
import { BedWars } from './bedwars.js';
import { CELL } from '../world/building.js';
import { SURGE, FLOOD, STAGES, pressureAt, floodRise } from './rules.js';
import { WEATHER, stormLabel } from '../weather/weather.js';

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

// The menu holds the lobby until the host starts the match; then everyone
// spawns at their team's base, with its bed and bahay kubo in their
// inventory. The match opens with the server's build phase: a countdown,
// and barriers that keep each team out of the others' bases until it
// ends, in fair weather. Then it's bed wars (bedwars.js) while a bagyo
// builds on the match's clock (rules.js): the weather and the climate
// follow it, the sea rises, and any bed the water reaches is washed away.
// menu: the menu's element (ui/menu.js), which has the class lobby while
// the lobby is on. Returns { inLobby, intro, team, bases, barriersUp,
// fighting, strike, pressure, forecast, update(dt) }: while inLobby, the
// game can't be started; pressure is the climate's (0..1), and forecast
// the weather panel's line about what's coming.
export function createMatch({ net, seed, error }, { terrain, player, hud, menu, scene, sea, camera, weather, building, inventory, spears, timber, trees, sky, sound }) {
  menu.classList.add('mp', 'lobby');
  const leave = () => { location.href = location.pathname; };
  let name = '';
  try { name = localStorage.getItem(NAME_KEY) ?? ''; } catch { /* storage blocked */ }
  let joined = false;   // asked to join, so ask again after a reconnect
  let inMatch = false;  // the match is on (and we're in it, playing or watching)
  let team = null;      // ours, once the match is on (null for a spectator)
  let teamIndex = -1;
  let bases = null;     // every team's, once the match is on
  let barriers = null;
  let wars = null;      // the fighting, once the match is on
  let buildEnds = 0;    // when the build phase ends (performance.now() time), while it lasts
  let stormStart = 0;   // when the barriers came down (performance.now() time), once they have
  let surgeAt = SURGE, floodAt = SURGE + FLOOD.after;   // seconds after that: the surge, and the flood
  let surged = false;
  let warned = false, bumped = -Infinity, bannerUntil = 0;
  const timer = document.getElementById('match-timer');

  // The build phase is over (the server says so, with the storm's timing):
  // the barriers come down and the bagyo starts building.
  const open = ({ surge = SURGE, flood = SURGE + FLOOD.after } = {}) => {
    if (!buildEnds) return;
    buildEnds = 0;
    barriers.open();
    wars.peace = false;
    stormStart = performance.now();
    surgeAt = surge;
    floodAt = flood;
    hud.message(`The barriers are down: every base is open. A bagyo is coming: the sea will rise, and any bed the water reaches is washed away. Its storm surge peaks in ${span(surge * 1000)}.`, 9);
    timer.textContent = 'Barriers down · every base is open';
    timer.className = 'open';
    bannerUntil = performance.now() + 4000;
  };
  // Seconds since the barriers came down.
  const stormTime = () => (performance.now() - stormStart) / 1000;
  // The weather of the storm's stage now, what comes next and when; the
  // flood, once it's come; and the countdown at the top of the screen, to
  // the surge, then to the flood, then how high it has risen.
  const storm = () => {
    const t = stormTime();
    sea.flood = floodRise(t - floodAt);
    const i = STAGES.findLastIndex((stage) => t >= stage.at * surgeAt);
    const now = STAGES[i], next = STAGES[i + 1];
    weather.follow(now.weather, now.severity, next?.weather ?? 'storm', (next ? next.at * surgeAt : surgeAt) - t);
    if (performance.now() < bannerUntil) return;
    const line = (...parts) => {
      const text = parts.filter(Boolean).join(' · ');
      return text[0].toUpperCase() + text.slice(1);
    };
    const out = wars.out && 'You’re out';
    if (t >= floodAt) {
      timer.textContent = line(out, 'the flood is rising', `+${sea.flood.toFixed(1)} m`);
      timer.className = 'final';
    } else if (surged) {
      timer.textContent = line(out, 'storm surge', `the flood in ${clock((floodAt - t) * 1000)}`);
      timer.className = floodAt - t < 60 ? 'final' : 'soon';
    } else {
      timer.textContent = line(out, weather.signal && `Signal No. ${weather.signal}`, `storm surge in ${clock((surgeAt - t) * 1000)}`);
      timer.className = surgeAt - t < 60 ? 'soon' : '';
    }
  };
  // Running into another team's barrier.
  const keepOut = (pos, vel) => {
    const hit = barriers?.keepOut(pos, vel) ?? -1;
    if (hit < 0 || performance.now() - bumped < 4000) return;
    bumped = performance.now();
    hud.message(`Team ${TEAMS[hit].name}’s base is closed until the barriers come down (${clock(buildEnds - bumped)}).`, 3);
  };

  const ui = new LobbyUI(menu.querySelector('#lobby'), {
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
    get inLobby() { return menu.classList.contains('lobby'); },
    get intro() {
      if (!inMatch) return null;
      if (!team) return 'You’re watching the match. Click to follow a player, right-click to fly freely; WASD, Space and C fly you about.';
      const where = `You’re on Team ${team.name}, on the ${team.shore} shore.`;
      const left = buildEnds - performance.now();
      return buildEnds && left > 1000
        ? `${where} Barriers keep the other teams out of every base for ${span(left)}. Put up your team’s bahay kubo and place your bed from your inventory (right-click), wherever you like outside the other bases, and build while you can. Then a bagyo builds and the sea rises: any bed the water reaches is washed away.`
        : where;
    },
    get team() { return team; },
    get bases() { return bases; },
    get barriersUp() { return !!barriers?.up; },
    // Up and about in the match, so a swing can hit someone.
    get fighting() { return !!wars?.fighting; },
    // A swing landing (ray: from your eye; tool: what's in your hand, or
    // 'none'). Returns true if it hit another team's player or bed.
    strike: (ray, tool) => wars?.strike(ray, tool) ?? false,
    // Your spear thrown (from, vel: Vector3s; charge: how far it was drawn
    // back), and a stretch of its flight (ray, length): how far along it
    // passes through another team's player (reported), or null.
    throwSpear: (from, vel, charge) => wars?.throwSpear(from, vel, charge),
    spearStrike: (ray, length) => wars?.spearStrike(ray, length) ?? null,
    // What the other players see: a swing, and a spear being drawn back.
    acted: () => wars?.acted(),
    drawing: (on) => { if (wars) wars.drawing = on; },
    // Your team's bed, while it's in your inventory: where it would go
    // (aiming along ray; null hides it), putting it down, turning it.
    aimBed: (ray) => wars?.aimBed(ray) ?? null,
    placeBed: (ray) => wars?.placeBed(ray),
    turnBed: () => wars?.turnBed(),
    // And its bahay kubo, likewise (R turns its door).
    aimKubo: (ray) => wars?.aimKubo(ray) ?? null,
    placeKubo: (ray) => wars?.placeKubo(ray),
    turnKubo: () => wars?.turnKubo(),
    // Watching (a spectator, or out): the camera is the spectator's
    // (spectator.js), moved by the keys held (keys); click follows the next
    // player, right-click flies freely.
    get spectating() { return !!wars?.spectating; },
    // Players to show on the map: intruders in your base, or (watching) everyone.
    get revealed() { return wars?.revealed() ?? []; },
    spectate: (dt, keys) => wars?.spectator.update(dt, keys),
    followNext: () => wars?.spectator.next(),
    flyFreely: () => wars?.spectator.free(),
    get pressure() { return stormStart ? pressureAt(stormTime(), surgeAt) : 0; },
    // A blow of yours on a tree (from: where you stood), for the others' games.
    chopped(tree, from) {
      if (!inMatch) return;
      const r = (x) => Math.round(x * 100) / 100;
      net.send('chop', { tree: trees.indexOf(tree), from: [r(from.x), r(from.z)] });
    },
    get opened() { return !!stormStart; },
    // A building plan, refused within BASE_RADIUS of another team's base
    // (one in the match).
    checkPlan(plan) {
      if (!plan?.ok || !wars) return plan;
      const c = plan.cell ?? plan, x = c.x0 + CELL / 2, z = c.z0 + CELL / 2;
      const other = [...wars.teams.keys()].find((t) => t !== teamIndex && Math.hypot(bases[t].x - x, bases[t].z - z) < BASE_RADIUS);
      return other === undefined ? plan : { ...plan, ok: false, reason: `Too close to Team ${TEAMS[other].name}’s base` };
    },
    get forecast() {
      if (buildEnds) return `Next: ${WEATHER.rain.label}, when the barriers come down`;
      if (!stormStart) return null;
      const t = stormTime();
      if (t >= floodAt) return 'Next: the flood keeps rising, faster and faster';
      if (surged) return `Next: the flood in ${clock((floodAt - t) * 1000)}`;
      const next = STAGES.find((stage) => stage.at * surgeAt > t);
      const label = !next ? 'Storm surge' : next.weather === 'storm' ? stormLabel(next.severity) : WEATHER[next.weather].label;
      return `Next: ${label} in ${clock(((next ? next.at : 1) * surgeAt - t) * 1000)}`;
    },

    // Every frame: the fighting, the barriers, the weather, and the
    // countdown at the top of the screen.
    update(dt) {
      wars?.update(dt);
      barriers?.update(dt);
      if (stormStart) storm();
      if (!buildEnds) return;
      const left = buildEnds - performance.now();
      // Fair weather to build in, clouding over in the last minute.
      weather.follow(left < 60000 ? 'overcast' : 'clear', 0, 'rain', Math.max(0, left / 1000));
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
    if (!inMatch) ui.render(state, net.id);
    else wars?.left(state.players);
  });
  net.on('notice', (text) => ui.notice(text));
  net.on('start', ({ players, buildLeft = 0, buildTime = buildLeft / 1000 }) => {
    const me = players.find((p) => p.id === net.id);
    if (!me) return;   // it started without us
    inMatch = true;
    // The time of day (and so the tide) runs on the match's clock, the same in every game.
    const began = performance.now() - (buildTime * 1000 - buildLeft);
    sky.follow(() => (performance.now() - began) / 1000);
    team = TEAMS[me.team] ?? null;
    teamIndex = me.team;
    bases = findBases(terrain);
    if (me.team !== WATCH) {
      player.spawn = bases[me.team];
      player.respawn();
    }
    menu.classList.remove('lobby');
    ui.showMatch(team, players);
    wars = new BedWars({ net, players, me: net.id, bases, terrain, scene, player, camera, hud, building, inventory, sea, spears, sound, peace: buildLeft > 0 });
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
  // A blow on a tree in another player's game: in ours too, so it comes
  // down for everyone (each game keeps its own logs).
  net.on('chop', ({ tree, from } = {}) => {
    const t = trees[tree];
    if (t && Array.isArray(from)) timber.chop(t, { x: from[0], z: from[1] }, true);
  });
  // The storm surge, at the storm's peak.
  net.on('surge', () => {
    surged = true;
    wars?.surge();
  });
  // The flood (each game raises the sea itself, from the match's clock).
  net.on('flood', () => wars?.flood());
  // After a reconnect the server says hello again.
  net.on('welcome', (hello) => {
    if (hello.seed !== seed) location.reload();   // it restarted with another island
    else if (inMatch) hud.message('Back in touch with the game server.', 4);
    else if (joined) net.send('join', name);
  });
  net.on('connect', () => { if (!inMatch) ui.notice('Reconnected.', 2); });
  const lost = () => {
    if (inMatch) hud.message('Lost touch with the game server. Trying to reconnect…', 5);
    else ui.notice('Lost touch with the game server. Trying to reconnect…', 60);
  };
  net.on('disconnect', lost);
  // It may have dropped while the island was being generated.
  if (!net.connected) lost();
  return match;
}
