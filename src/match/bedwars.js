import * as THREE from 'three';
import { uniforms } from '../shared.js';
import { TEAMS, BASE_RADIUS, WATCH } from './teams.js';
import { CELL } from '../world/building.js';
import { BED_HP, RESPAWN_TIME, REACH } from './rules.js';
import { RemotePlayers } from './remotePlayers.js';
import { Beds } from './beds.js';
import { Spectator } from './spectator.js';
import { itemCode } from '../items/items.js';

const $ = (id) => document.getElementById(id);
const SEND = 0.05;   // seconds between telling the server where you are
const FEED = 5000;   // ms a line stays in the match feed
const FLOODED = 0.25;   // metres of water over a bed's foot that wash it away (up to its mattress)

// The bed-wars side of a match (see rules.js), from the start on: the other
// players, your team's bed (in your inventory until someone places it), the
// beds, swinging at them, being hurt, going down and coming back at your
// bed, being out once it's gone (and then watching the rest), the teams'
// state on screen, and the end. A spectator (team WATCH) only watches.
// net: the connection; players: the match's ([{ id, name, team }]); me:
// your id; peace: true while the build phase lasts (nothing can be hurt
// until the barriers come down).
export class BedWars {
  constructor({ net, players, me, bases, terrain, scene, player, camera, hud, building, inventory, sea, spears, peace }) {
    Object.assign(this, { net, player, camera, hud, building, inventory, sea, bases, peace });
    this.floodClock = 0;
    this.surf = {};
    this.me = me;
    ({ team: this.team, name: this.name } = players.find((p) => p.id === me));
    this.watching = this.team === WATCH;   // a spectator, from the start
    const playing = players.filter((p) => p.team !== WATCH);
    this.out = false;
    this.over = false;
    this.downAt = 0;          // when you went down (performance.now()), while you're down
    this.comingBack = false;  // your bed stood when you went down
    this.hurtBy = null;       // who hit you last
    this.sendClock = 0;
    this.warnedBed = -Infinity;
    this.warnedPeace = -Infinity;
    this.intruders = new Set();   // other teams' players in your base, as last seen
    this.intruderClock = 0;
    this.dir = new THREE.Vector3();
    // What the others see you doing: swings and throws so far (counted
    // round 0..99), and whether you're drawing a spear back.
    this.acts = 0;
    this.drawing = false;

    // Each team in the match: its bed's health, and its players.
    this.teams = new Map();
    for (const p of [...playing].sort((a, b) => a.team - b.team)) {
      if (!this.teams.has(p.team)) this.teams.set(p.team, { hp: BED_HP, members: new Map() });
      this.teams.get(p.team).members.set(p.id, { name: p.name, out: false });
    }
    this.remotes = new RemotePlayers(scene);
    this.remotes.add(playing, me);
    // Watching: a free camera, or following a player (spectator.js).
    this.spectator = new Spectator(camera, this.remotes, terrain);
    if (this.watching) this.spectator.start(true);
    // Your team's bed starts in your inventory (and your teammates'): the
    // first to place it decides where it stands. The server hears where
    // the bases are and where a bed nobody placed would go.
    this.beds = new Beds(scene, terrain, building, bases, [...this.teams.keys()]);
    this.bedTurn = 0;       // quarter turns (R) for placing it
    this.placing = false;   // asked the server to place it, waiting to hear
    // The team's bahay kubo works the same way: in everyone's inventory,
    // and the first to put it up decides where.
    this.kubos = new Map();     // every team's that's up: { i0, j0, turn, deck }
    this.kuboTurn = 0;          // which side its door faces (R)
    this.placingKubo = false;
    this.showingKubo = false;   // its see-through preview is up
    if (!this.watching) {
      inventory.add('kubo', 1);
      inventory.add('bed', 1);
    }
    net.send('beds', this.beds.defaults);
    net.send('bases', bases.map(({ x, z }) => ({ x, z })));
    net.send('kubos', this.kuboDefaults());

    this.panel = $('teams-panel');
    this.feedList = $('match-feed');
    this.deathScreen = $('death');
    this.render();
    $('match-hud').hidden = false;
    player.onDeath = () => this.goDown();

    net.on('moves', (update) => this.remotes.receive(update));
    net.on('hurt', (hit) => this.hurt(hit));
    net.on('bed', ({ team, hp }) => this.bedHit(team, hp));
    net.on('bedDestroyed', ({ team, by, flood }) => this.bedDestroyed(team, by, flood));
    net.on('death', (down) => this.death(down));
    net.on('respawned', ({ id }) => this.respawned(id));
    net.on('matchOver', ({ winner }) => this.end(winner));
    net.on('bedPlaced', (bed) => this.bedPlaced(bed));
    net.on('bedRefused', ({ reason }) => {
      this.placing = false;
      hud.message(reason, 3);
    });
    net.on('kuboPlaced', (kubo) => this.kuboPlaced(kubo));
    net.on('kuboRefused', ({ reason }) => {
      this.placingKubo = false;
      hud.message(reason, 3);
    });
    // What's built is shared, and tools can break it once the fighting is on.
    building.share({
      team: this.team, teamName: (team) => `Team ${TEAMS[team].name}`, send: (msg) => net.send('build', msg),
      canBreak: () => this.fighting && !this.peace,
    });
    net.on('build', (msg) => building.apply(msg));
    net.on('pieceHit', ({ key, amount }) => building.apply({ op: 'hit', key, amount }));
    // Someone else's spear, flying where they threw it (only to be seen,
    // and heard within 40 m).
    const vec = (a) => (Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? new THREE.Vector3(...a) : null);
    net.on('throw', ({ from, vel } = {}) => {
      const f = vec(from), v = vec(vel);
      if (f && v) spears?.ghost(f, v, Math.max(0, 1 - f.distanceTo(this.camera.position) / 40));
    });
  }

  // Up and about (not down, not out, the match not over).
  get fighting() { return !this.over && !this.out && !this.watching && !this.player.dead; }

  // Watching (a spectator, or out of the match).
  get spectating() { return this.spectator.on; }

  bedStands(team) { return (this.teams.get(team)?.hp ?? 0) > 0; }
  who(name) { return name === this.name ? 'you' : name; }

  // Every frame: the others move, the flood is watched, and the server
  // hears where you are.
  update(dt) {
    this.remotes.update(dt);
    this.watchFlood(dt);
    this.watchBase(dt);
    if (this.downAt && this.comingBack) {
      const left = Math.max(1, Math.ceil(RESPAWN_TIME - (performance.now() - this.downAt) / 1000));
      this.deathScreen.querySelector('span').textContent = `Back ${this.bedStands(this.team) ? 'at your bed ' : ''}in ${left}…`;
    }
    if (!this.fighting || (this.sendClock += dt) < SEND) return;
    this.sendClock = 0;
    const p = this.player.pos, v = this.player.vel;
    this.camera.getWorldDirection(this.dir);
    const r = (x) => Math.round(x * 100) / 100;
    // With what's in your hand (negative while a spear is drawn back), and your swings so far.
    const held = itemCode(this.inventory.current?.id) * (this.drawing ? -1 : 1);
    this.net.send('move', [r(p.x), r(p.y), r(p.z), r(Math.atan2(-this.dir.x, -this.dir.z)), r(Math.hypot(v.x, v.z)), held, this.acts], true);
  }

  // A swing of what's in your hand (or your fist), for the others to see.
  acted() { this.acts = (this.acts + 1) % 100; }

  // Once the barriers are down, anyone from another team inside your base
  // (within BASE_RADIUS of it, where its barrier stood) shows on your map
  // (revealed()), and you hear when they come in.
  watchBase(dt) {
    if ((this.intruderClock += dt) < 0.5) return;
    this.intruderClock = 0;
    const now = new Set(this.spectating ? [] : this.revealed().map((p) => p.id));
    for (const id of now) {
      if (this.intruders.has(id)) continue;
      const p = this.remotes.players.get(id);
      this.hud.message(`${p.name} of Team ${TEAMS[p.team].name} is in your base! They show on your map (K).`, 4);
      this.feed(`${p.name} came into your base`);
    }
    this.intruders = now;
  }

  // Who shows on your map: once the barriers are down, any other team's
  // player inside your base; watching (a spectator, or out), everyone.
  // [{ id, name, team, x, z }].
  revealed() {
    const base = this.bases[this.team], list = [];
    for (const p of this.remotes.players.values()) {
      const at = p.model.object;
      if (!at.visible) continue;
      const inside = !this.peace && p.team !== this.team && base && Math.hypot(at.position.x - base.x, at.position.z - base.z) < BASE_RADIUS;
      if (this.spectating || inside) list.push({ id: p.id, name: p.name, team: p.team, x: at.position.x, z: at.position.z });
    }
    return list;
  }

  // The flood: a bed the water stays over for a moment (waves and all) is
  // washed away. Any game that sees it tells the server, once a bed.
  watchFlood(dt) {
    if (this.peace || (this.floodClock += dt) < 0.25) return;
    const step = this.floodClock;
    this.floodClock = 0;
    for (const [team, bed] of this.beds.beds) {
      if (bed.flooded || !this.bedStands(team)) continue;
      const water = this.sea.water.surface(bed.x, bed.z, uniforms.uTime.value, this.surf).height;
      bed.wet = water > bed.y + FLOODED ? (bed.wet ?? 0) + step : 0;
      if (bed.wet < 1.5) continue;
      bed.flooded = true;
      this.net.send('bedFlooded', { team });
    }
  }

  // With your team's bed selected: where it would go, aiming along ray (a
  // see-through bed shows it), as { ok, reason, ... }, or null. A null ray
  // hides it.
  aimBed(ray) {
    if (!ray || this.placing || !this.fighting) {
      this.beds.hideGhost();
      return null;
    }
    return this.beds.plan(ray, this.team, this.bedTurn);
  }

  turnBed() { this.bedTurn = (this.bedTurn + 1) % 4; }

  // Right-click with the bed selected: ask the server to put it down where
  // you're aiming. It takes it out of everyone's inventory once it's down.
  placeBed(ray) {
    if (this.placing || !this.fighting || this.beds.placed(this.team)) return;
    const plan = this.beds.plan(ray, this.team, this.bedTurn);
    if (!plan?.ok) {
      this.hud.message(plan ? `${plan.reason}.` : 'Aim at the ground to place the bed.', 2);
      return;
    }
    const r = (v) => Math.round(v * 100) / 100;
    this.placing = true;
    this.net.send('placeBed', { x: r(plan.x), y: r(plan.y), z: r(plan.z), yaw: r(plan.yaw) });
  }

  // --- The bahay kubo.
  // Where each team's goes up if nobody puts it up before the barriers come
  // down ({ i0, j0, turn, deck } in TEAMS order, null for teams not in the
  // match): a little behind where the team spawns, its door facing back
  // towards the middle of the island, on the first spot nearby it fits.
  kuboDefaults() {
    return TEAMS.map((_, team) => {
      if (!this.teams.has(team)) return null;
      const b = this.bases[team], r = Math.hypot(b.x, b.z) || 1, ux = b.x / r, uz = b.z / r;
      const turn = Math.abs(ux) > Math.abs(uz) ? (ux > 0 ? 3 : 1) : (uz > 0 ? 0 : 2);
      const spot = (back, side) => {
        const i0 = Math.round((b.x + ux * back - uz * side) / CELL) - 1, j0 = Math.round((b.z + uz * back + ux * side) / CELL) - 1;
        const fit = this.building.kuboFits(i0, j0, turn);
        return { i0, j0, turn, deck: Math.round(fit.deck * 100) / 100, ok: fit.ok };
      };
      const tries = [[8, 0], [8, 5], [8, -5], [13, 0], [4, 6], [4, -6], [16, 5], [16, -5]].map(([back, side]) => spot(back, side));
      const { ok, ...at } = tries.find((t) => t.ok) ?? tries[0];
      return at;
    });
  }

  // With your team's kubo selected: where it would go, aiming along ray
  // (see-through, green or red), as { ok, reason, ... }, or null. A null ray
  // takes the preview down.
  aimKubo(ray) {
    if (!ray || this.placingKubo || !this.fighting) {
      if (this.showingKubo) this.building.preview(null);
      this.showingKubo = false;
      return null;
    }
    let plan = this.building.kuboPlan(ray, this.kuboTurn);
    if (plan?.ok) {
      const other = [...this.teams.keys()].find((t) => t !== this.team && Math.hypot(this.bases[t].x - plan.x, this.bases[t].z - plan.z) < BASE_RADIUS + 3);
      if (other !== undefined) plan = { ...plan, ok: false, reason: `Not in Team ${TEAMS[other].name}’s base` };
    }
    this.building.preview(plan);
    this.showingKubo = true;
    return plan;
  }

  turnKubo() { this.kuboTurn = (this.kuboTurn + 1) % 4; }

  // Right-click with the kubo selected: ask the server to put it up there.
  placeKubo(ray) {
    if (this.placingKubo || !this.fighting || this.kubos.has(this.team)) return;
    const plan = this.aimKubo(ray);
    if (!plan?.ok) {
      this.hud.message(plan ? `${plan.reason}.` : 'Aim at the ground to put up the bahay kubo.', 2);
      return;
    }
    this.placingKubo = true;
    this.net.send('placeKubo', { i0: plan.i0, j0: plan.j0, turn: plan.turn, deck: Math.round(plan.deck * 100) / 100 });
  }

  // A team's bahay kubo went up (by a player, or at its base when nobody put
  // it up before the barriers came down): the same in every game.
  kuboPlaced({ team, i0, j0, turn, deck, by, auto }) {
    if (this.kubos.has(team)) return;
    this.kubos.set(team, { i0, j0, turn, deck });
    this.building.buildKubo({ i0, j0, turn, deck }, { team });
    if (team !== this.team) return;
    this.placingKubo = false;
    this.aimKubo(null);
    this.inventory.remove('kubo', this.inventory.count('kubo'));
    this.hud.message(auto
      ? 'Nobody put up your team’s bahay kubo, so it went up at your base.'
      : `${by === this.name ? 'Your team’s bahay kubo is up' : `${by} put up your team’s bahay kubo`}: a house on stilts, above the floods. Your bed is safest inside.`, 6);
  }

  // A team's bed was put down: by a player ({ by }), or at its base when
  // the barriers came down without anyone placing it ({ auto }). Yours:
  // out of your inventory, and from now on you come back beside it.
  bedPlaced({ team, x, y, z, yaw, by, auto }) {
    this.beds.place(team, { x, y, z, yaw });
    if (team === this.team) {
      this.placing = false;
      this.beds.hideGhost();
      this.inventory.remove('bed', this.inventory.count('bed'));
      this.player.spawn = this.beds.spawnBeside(team);
      this.hud.message(auto
        ? 'Nobody placed your team’s bed, so it went down at your base.'
        : by === this.name
          ? 'Your team’s bed is down. While it stands, you come back beside it.'
          : `${by} placed your team’s bed. While it stands, you come back beside it.`, 5);
    }
    this.render();
  }

  // A swing landing (ray: from your eye, the way you look; tool: what's in
  // your hand, or 'none'): at whatever is nearest in reach, of another
  // team's players and beds, and anything built (yours too, but your own
  // team's bahay kubo stops it). Returns true if it hit something (so the
  // tool wears).
  strike(ray, tool) {
    if (!this.fighting) return false;
    const foe = this.remotes.aimed(ray, REACH), bed = this.beds.aimed(ray, REACH, this.team);
    const enemy = foe && foe.team !== this.team ? foe : null;
    const piece = this.building.aimed(ray, REACH);
    const nearest = [enemy, bed, piece].filter(Boolean).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || (nearest === piece && piece.kubo && piece.team === this.team)) return false;
    if (this.peace) {
      if (performance.now() - this.warnedPeace > 3000) {
        this.warnedPeace = performance.now();
        this.hud.message('Nothing can be hurt or broken until the barriers come down.', 3);
      }
      return false;
    }
    if (nearest === enemy) this.net.send('hit', { target: enemy.id, tool });
    else if (nearest === bed) this.net.send('hitBed', { team: bed.team, tool });
    else this.net.send('hitPiece', { key: piece.key, tool });
    const crosshair = $('crosshair');
    crosshair.classList.add('hit');
    setTimeout(() => crosshair.classList.remove('hit'), 140);
    return true;
  }

  // Your spear thrown (from, vel: Vector3s; charge 0..1): the others see it
  // fly, and the server keeps it for the hit it may make.
  throwSpear(from, vel, charge) {
    this.acted();
    const r = (x) => Math.round(x * 100) / 100;
    this.net.send('throw', { from: from.toArray().map(r), vel: vel.toArray().map(r), charge: r(charge) });
  }

  // A stretch of your spear's flight (ray, `length` metres along it): if it
  // passes through another team's player, the server hears (it decides
  // whether it counts) and the spear stops there. Nothing is hurt until the
  // barriers come down. Returns how far along, or null.
  spearStrike(ray, length) {
    if (this.over || this.peace) return null;
    const foe = this.remotes.aimed(ray, length);
    if (!foe || foe.team === this.team) return null;
    this.net.send('spearHit', { target: foe.id });
    const crosshair = $('crosshair');
    crosshair.classList.add('hit');
    setTimeout(() => crosshair.classList.remove('hit'), 140);
    return foe.distance;
  }

  // Hit by another player: hurt, knocked back, and a red flash.
  hurt({ amount, by, from }) {
    if (!this.fighting) return;
    const p = this.player;
    p.hurt(amount);
    this.hurtBy = by;
    const dx = p.pos.x - from[0], dz = p.pos.z - from[1], d = Math.hypot(dx, dz) || 1;
    p.vel.x += (dx / d) * 6;
    p.vel.z += (dz / d) * 6;
    p.vel.y = Math.max(p.vel.y, 3.5);
    const flash = $('hurt');
    flash.classList.add('show');
    requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('show')));
  }

  // Your health ran out: the server decides what's next (back at your bed,
  // or out). Until then you lie where you fell.
  goDown() {
    if (this.out || this.over) {   // only watching: just wake up at the base again
      this.player.dead = false;
      this.player.respawn();
      return;
    }
    this.net.send('died');
    this.downAt = performance.now();
    this.comingBack = this.bedStands(this.team);
    this.deathScreen.hidden = false;
    this.deathScreen.querySelector('b').textContent = this.hurtBy ? `Knocked out by ${this.hurtBy}` : 'You went down';
    this.deathScreen.querySelector('span').textContent = this.comingBack ? '' : 'Your team’s bed is gone…';
  }

  // Back up at your bed.
  back() {
    this.downAt = 0;
    this.hurtBy = null;
    this.deathScreen.hidden = true;
    this.player.dead = false;
    this.player.respawn();
  }

  // Out for good: your bed was gone when you went down. After a moment you
  // watch the rest of the match (spectator.js), from where you fell.
  goOut() {
    this.out = true;
    this.downAt = 0;
    this.deathScreen.hidden = false;
    this.deathScreen.querySelector('b').textContent = 'You’re out';
    this.deathScreen.querySelector('span').textContent = 'Your team’s bed was gone, so there’s no coming back. You can watch the rest of the match.';
    setTimeout(() => {
      if (this.over) return;
      this.deathScreen.hidden = true;
      this.player.dead = false;
      this.spectator.start();
      this.hud.message('You’re watching now. Click to follow a player, right-click to fly freely.', 6);
    }, 5000);
  }

  bedHit(team, hp) {
    const t = this.teams.get(team);
    if (!t) return;
    t.hp = hp;
    if (team === this.team && hp > 0 && performance.now() - this.warnedBed > 6000) {
      this.warnedBed = performance.now();
      this.hud.message('Your bed is under attack!', 3);
    }
    this.render();
  }

  // A bed broken (by), or washed away when the flood reached it.
  bedDestroyed(team, by, flood = false) {
    const t = this.teams.get(team);
    if (t) t.hp = 0;
    this.beds.destroy(team);
    const name = `Team ${TEAMS[team].name}’s bed`;
    if (team === this.team) this.hud.message(`${flood ? 'The flood reached your bed and washed it away' : `${by} destroyed your bed`}! Go down now and you’re out.`, 6);
    else if (!flood && by === this.name) this.hud.message(`You destroyed ${name}!`, 4);
    this.feed(flood ? `${name} was washed away by the flood` : `${name} was destroyed by ${this.who(by)}`);
    this.render();
  }

  // The storm surge, at the storm's peak: the sea is as high as it gets.
  surge() {
    this.hud.message('The storm surge is here! Any bed the water reaches is washed away; a bed raised above it stays dry.', 8);
    this.feed('The storm surge is here');
  }

  // The flood at the end of the match: the sea climbs faster and faster.
  flood() {
    this.hud.message('The flood is coming! The sea is rising faster and faster: soon no bed will stay dry, and the last team standing wins.', 9);
    this.feed('The flood is coming');
  }

  // Someone went down (out, if their bed was gone).
  death({ id, name, by, out }) {
    for (const t of this.teams.values()) if (t.members.has(id)) t.members.get(id).out = out;
    if (id === this.me) {
      if (out) this.goOut();
    } else {
      this.remotes.hide(id);
    }
    const who = id === this.me ? 'You' : name;
    this.feed(`${who} ${by ? `${id === this.me ? 'were' : 'was'} knocked out by ${this.who(by)}` : 'went down'}${out ? ' · out' : ''}`);
    this.render();
  }

  respawned(id) {
    if (id === this.me) this.back();
  }

  // Players who left the match (from the lobby's list of who's still in).
  left(players) {
    if (this.over) return;
    for (const t of this.teams.values()) {
      for (const [id, m] of t.members) {
        if (players.some((p) => p.id === id)) continue;
        t.members.delete(id);
        this.remotes.remove(id);
        this.feed(`${m.name} left the match`);
      }
    }
    this.render();
  }

  // A line under the teams for a few seconds.
  feed(text) {
    const line = document.createElement('div');
    line.textContent = text;
    this.feedList.append(line);
    setTimeout(() => line.remove(), FEED);
    while (this.feedList.children.length > 5) this.feedList.firstChild.remove();
  }

  // The teams on screen: each one's bed, and how many of its players are left.
  render() {
    this.panel.replaceChildren(...[...this.teams].map(([team, t]) => {
      const row = document.createElement('div');
      const left = [...t.members.values()].filter((m) => !m.out).length;
      row.className = `team-row${team === this.team ? ' ours' : ''}${left ? '' : ' gone'}`;
      row.style.setProperty('--team', TEAMS[team].color);
      const dot = document.createElement('i'), label = document.createElement('b'), state = document.createElement('span');
      label.textContent = TEAMS[team].name;
      const bed = t.hp <= 0 ? 'no bed' : this.beds.placed(team) ? `bed ${Math.round((t.hp / BED_HP) * 100)}%` : 'bed not placed';
      state.textContent = left ? `${bed} · ${left} left` : 'out';
      row.append(dot, label, state);
      return row;
    }));
  }

  // The match is over: who won (-1 for nobody), and the way back to the
  // lobby. time: it ended when time ran out after the surge.
  // The match is over: winner (a team, or -1 if nobody's left).
  end(winner) {
    this.over = true;
    this.player.setInput(false);
    this.player.dragLook = false;
    document.exitPointerLock?.();
    this.deathScreen.hidden = true;
    const screen = $('match-end');
    const title = screen.querySelector('h2');
    title.textContent = winner === this.team ? 'Your team wins!' : winner >= 0 ? `Team ${TEAMS[winner].name} wins` : 'Nobody is left';
    title.style.setProperty('--team', TEAMS[winner]?.color ?? '');
    screen.querySelector('p').textContent = winner >= 0 ? 'Every other team is out.' : 'Every team went down for good.';
    screen.querySelector('button').onclick = () => location.reload();
    screen.hidden = false;
  }
}
