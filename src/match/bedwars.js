import * as THREE from 'three';
import { TEAMS } from './teams.js';
import { BED_HP, RESPAWN_TIME, REACH } from './rules.js';
import { RemotePlayers } from './remotePlayers.js';
import { Beds } from './beds.js';

const $ = (id) => document.getElementById(id);
const SEND = 0.05;   // seconds between telling the server where you are
const FEED = 5000;   // ms a line stays in the match feed

// The bed-wars side of a match (see rules.js), from the start on: the other
// players, your team's bed (in your inventory until someone places it), the
// beds, swinging at them, being hurt, going down and coming back at your
// bed, being out once it's gone, the teams' state on screen, and the end.
// net: the connection; players: the match's ([{ id, name, team }]); me:
// your id; peace: true while the build phase lasts (nothing can be hurt
// until the barriers come down).
export class BedWars {
  constructor({ net, players, me, bases, terrain, scene, player, camera, hud, building, inventory, peace }) {
    Object.assign(this, { net, player, camera, hud, building, inventory, peace });
    this.me = me;
    ({ team: this.team, name: this.name } = players.find((p) => p.id === me));
    this.out = false;
    this.over = false;
    this.downAt = 0;          // when you went down (performance.now()), while you're down
    this.comingBack = false;  // your bed stood when you went down
    this.hurtBy = null;       // who hit you last
    this.sendClock = 0;
    this.warnedBed = -Infinity;
    this.warnedPeace = -Infinity;
    this.dir = new THREE.Vector3();

    // Each team in the match: its bed's health, and its players.
    this.teams = new Map();
    for (const p of [...players].sort((a, b) => a.team - b.team)) {
      if (!this.teams.has(p.team)) this.teams.set(p.team, { hp: BED_HP, members: new Map() });
      this.teams.get(p.team).members.set(p.id, { name: p.name, out: false });
    }
    this.remotes = new RemotePlayers(scene);
    this.remotes.add(players, me);
    // Your team's bed starts in your inventory (and your teammates'): the
    // first to place it decides where it stands. The server hears where
    // the bases are and where a bed nobody placed would go.
    this.beds = new Beds(scene, terrain, building, bases, [...this.teams.keys()]);
    this.bedTurn = 0;       // quarter turns (R) for placing it
    this.placing = false;   // asked the server to place it, waiting to hear
    inventory.add('bed', 1);
    net.send('beds', this.beds.defaults);
    net.send('bases', bases.map(({ x, z }) => ({ x, z })));

    this.panel = $('teams-panel');
    this.feedList = $('match-feed');
    this.deathScreen = $('death');
    this.render();
    $('match-hud').hidden = false;
    player.onDeath = () => this.goDown();

    net.on('moves', (update) => this.remotes.receive(update));
    net.on('hurt', (hit) => this.hurt(hit));
    net.on('bed', ({ team, hp }) => this.bedHit(team, hp));
    net.on('bedDestroyed', ({ team, by }) => this.bedDestroyed(team, by));
    net.on('death', (down) => this.death(down));
    net.on('respawned', ({ id }) => this.respawned(id));
    net.on('matchOver', ({ winner, time }) => this.end(winner, time));
    net.on('bedPlaced', (bed) => this.bedPlaced(bed));
    net.on('bedRefused', ({ reason }) => {
      this.placing = false;
      hud.message(reason, 3);
    });
    // What's built is shared, and another team's tools can break it.
    building.share({ team: this.team, teamName: (team) => `Team ${TEAMS[team].name}`, send: (msg) => net.send('build', msg) });
    net.on('build', (msg) => building.apply(msg));
    net.on('pieceHit', ({ key, amount }) => building.apply({ op: 'hit', key, amount }));
  }

  // Up and about (not down, not out, the match not over).
  get fighting() { return !this.over && !this.out && !this.player.dead; }

  bedStands(team) { return (this.teams.get(team)?.hp ?? 0) > 0; }
  who(name) { return name === this.name ? 'you' : name; }

  // Every frame: the others move, and the server hears where you are.
  update(dt) {
    this.remotes.update(dt);
    if (this.downAt && this.comingBack) {
      const left = Math.max(1, Math.ceil(RESPAWN_TIME - (performance.now() - this.downAt) / 1000));
      this.deathScreen.querySelector('span').textContent = `Back ${this.bedStands(this.team) ? 'at your bed ' : ''}in ${left}…`;
    }
    if (!this.fighting || (this.sendClock += dt) < SEND) return;
    this.sendClock = 0;
    const p = this.player.pos, v = this.player.vel;
    this.camera.getWorldDirection(this.dir);
    const r = (x) => Math.round(x * 100) / 100;
    this.net.send('move', [r(p.x), r(p.y), r(p.z), r(Math.atan2(-this.dir.x, -this.dir.z)), r(Math.hypot(v.x, v.z))], true);
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
  // team's players, beds and what they built (your own team's builds stop
  // it). Returns true if it hit something (so the tool wears).
  strike(ray, tool) {
    if (!this.fighting) return false;
    const foe = this.remotes.aimed(ray, REACH), bed = this.beds.aimed(ray, REACH, this.team);
    const enemy = foe && foe.team !== this.team ? foe : null;
    const piece = this.building.aimed(ray, REACH);
    const nearest = [enemy, bed, piece].filter(Boolean).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || (nearest === piece && piece.team === this.team)) return false;
    if (this.peace) {
      if (performance.now() - this.warnedPeace > 3000) {
        this.warnedPeace = performance.now();
        this.hud.message('No fighting until the barriers come down.', 3);
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

  // Hit by another player: hurt, knocked back, and a red flash.
  hurt({ amount, by, from }) {
    if (!this.fighting) return;
    const p = this.player;
    p.health -= amount;
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
  // can look around again, unseen and unable to fight.
  goOut() {
    this.out = true;
    this.downAt = 0;
    this.deathScreen.hidden = false;
    this.deathScreen.querySelector('b').textContent = 'You’re out';
    this.deathScreen.querySelector('span').textContent = 'Your team’s bed was gone, so there’s no coming back. You can still look around.';
    setTimeout(() => {
      if (this.over) return;
      this.deathScreen.hidden = true;
      this.player.dead = false;
      this.player.respawn();
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

  bedDestroyed(team, by) {
    const t = this.teams.get(team);
    if (t) t.hp = 0;
    this.beds.destroy(team);
    if (team === this.team) this.hud.message(`${by} destroyed your bed! Go down now and you’re out.`, 6);
    else if (by === this.name) this.hud.message(`You destroyed Team ${TEAMS[team].name}’s bed!`, 4);
    this.feed(`Team ${TEAMS[team].name}’s bed was destroyed by ${this.who(by)}`);
    this.render();
  }

  // The storm surge washed away every bed still standing (teams): from now
  // on, going down is for good.
  surge(teams) {
    for (const team of teams) {
      const t = this.teams.get(team);
      if (t) t.hp = 0;
      this.beds.destroy(team);
    }
    this.hud.message('The storm surge washed away every bed! Going down is for good now: the last team standing wins, or the one with the most players left when time runs out.', 9);
    this.feed('The storm surge washed away every bed');
    this.render();
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
  end(winner, time = false) {
    this.over = true;
    this.player.setInput(false);
    this.player.dragLook = false;
    document.exitPointerLock?.();
    this.deathScreen.hidden = true;
    const screen = $('match-end');
    const title = screen.querySelector('h2');
    title.textContent = winner === this.team ? 'Your team wins!' : winner >= 0 ? `Team ${TEAMS[winner].name} wins` : time ? 'A draw' : 'Nobody is left';
    title.style.setProperty('--team', TEAMS[winner]?.color ?? '');
    screen.querySelector('p').textContent = time
      ? winner >= 0 ? 'Time ran out with the most players still standing.' : 'Time ran out with the teams tied.'
      : winner >= 0 ? 'Every other team is out.' : 'Every team went down for good.';
    screen.querySelector('button').onclick = () => location.reload();
    screen.hidden = false;
  }
}
