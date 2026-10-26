import * as THREE from 'three';
import { PlayerModel } from '../player/playerModel.js';
import { patchMaterial } from '../world/materials.js';
import { CELL, DECK, WALL_HEIGHT } from '../world/building.js';
import { TEAMS } from '../match/teams.js';
import { findBases } from '../match/bases.js';
import { Beds } from '../match/beds.js';

// The trailer (?trailer in the address): a scripted run of shots through
// the real game, each the island as it plays, recorded straight from the
// page to a 1920 × 1080 .mp4 with the game's own sound (in Chrome or Edge;
// on a dedicated graphics card for a smooth 60 fps). Shaped like Rust's:
// a cold open on a lone survivor on the beach, then what you do, a beat at
// a time, each named in a bold caption, rising to the storm, the flood
// and bed wars, and the title to close. Only what the game really does.
//
// The shots are set on whatever island loads: the survivor's beach (the
// spawn), the nearest tree inland, a stretch of shallows for a house on
// stilts, a reef with fish, and a bahay kubo inland, found when it starts.

const W = 1920, H = 1080;
const EYE = 1.7;
const GREEN = '#22b14c';
const ease = (u) => u * u * (3 - 2 * u);
const mix = (a, b, u) => a + (b - a) * u;
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const EDGE_KEYS = (i, j) => [`x${i},${j}`, `z${i + 1},${j}`, `x${i},${j + 1}`, `z${i},${j}`];
const SIDES = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// ctx: the game's parts the trailer drives (see main.js).
export function createTrailer(ctx) {
  const { scene, camera, renderer, terrain, water, sea, sky, weather, player, held, inventory, timber, building, spears, vegetation, ocean, audio, uniforms } = ctx;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  out.id = 'trailer-frame';
  out.hidden = true;
  document.body.append(out);
  const g2 = out.getContext('2d');

  let running = false, t = 0, shot = -1, local = 0, recorder = null, chunks = [], onEnd = null;
  let site = null;   // where each shot happens, found when it starts
  const actors = [];
  let beds = null;
  const surf = {};

  // --- Helpers.
  const ground = (x, z) => terrain.heightAt(x, z);
  const seaY = () => uniforms.uWaterLevel.value;
  const look = (x, y, z, tx, ty, tz) => {
    camera.position.set(x, y, z);
    camera.lookAt(tx, ty, tz);
  };
  // The weather now, held (tau: seconds to turn to it).
  const weatherTo = (key, severity, tau = 0.4) => {
    weather.hold = true;
    weather.setWeather(key, tau, severity);
    weather.next = key;
    weather.timeLeft = 9999;
  };
  const time = (hours) => { sky.state.time = hours / 24; };
  const hand = (id) => {
    const slot = id ? inventory.slots.findIndex((s) => s?.id === id) : inventory.slots.findIndex((s, i) => i < 9 && !s);
    if (slot >= 0) inventory.select(slot);
  };
  const ahead = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];

  // A survivor in a team's colour, walking at `speed`, facing `yaw`.
  function actor(i) {
    if (!actors[i]) {
      const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'player-model', snowMin: 0.95 });
      const model = new PlayerModel(TEAMS[i % TEAMS.length].color, { material });
      model.object.visible = false;
      scene.add(model.object);
      actors[i] = { model, speed: 0 };
    }
    return actors[i];
  }
  function put(i, x, z, yaw, speed = 0) {
    const a = actor(i);
    a.model.object.visible = true;
    a.model.object.position.set(x, ground(x, z), z);
    a.model.object.rotation.y = yaw;
    a.speed = speed;
    return a;
  }
  const hideActors = () => actors.forEach((a) => { if (a) a.model.object.visible = false; });

  // A spear from one point to another, flying for `flight` seconds, heard
  // louder the nearer it's thrown.
  function throwSpear(from, to, flight = 0.9) {
    const v = new THREE.Vector3((to.x - from.x) / flight, (to.y - from.y) / flight + 0.5 * 9.8 * flight, (to.z - from.z) / flight);
    spears.ghost(from.clone(), v, Math.max(0.7, 1 - from.distanceTo(camera.position) / 30));
  }
  const handOf = (i, reach = 0.5) => {
    const o = actor(i).model.object, [fx, fz] = ahead(o.rotation.y);
    return new THREE.Vector3(o.position.x + fx * reach, o.position.y + 1.55, o.position.z + fz * reach);
  };
  const chestOf = (i) => actor(i).model.object.position.clone().setY(actor(i).model.object.position.y + 1.2);

  // --- Where it all happens, on this island.
  function findSites() {
    const sp = player.spawn, [sx, sz] = ahead(sp.yaw);   // seaward from the spawn
    const s = { x: sp.x, z: sp.z, yaw: sp.yaw, sea: [sx, sz], land: [-sx, -sz], side: [-sz, sx] };
    const level = seaY();
    // The shallows: out from the beach to where it's just under water.
    let r = 0;
    while (r < 60 && ground(sp.x + sx * r, sp.z + sz * r) > level - 0.5) r += 0.5;
    const hx = sp.x + sx * (r + 2), hz = sp.z + sz * (r + 2);
    const i0 = Math.floor(hx / CELL) - 1, j0 = Math.floor(hz / CELL) - 1;
    let high = -Infinity;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) high = Math.max(high, ground((i0 + a + u) * CELL, (j0 + b + v) * CELL));
    }
    s.house = { i0, j0, top: Math.max(high, level) + 3, x: (i0 + 1) * CELL, z: (j0 + 1) * CELL };
    s.shore = { x: sp.x + sx * r, z: sp.z + sz * r };
    s.tree = nearestTree();
    // A reef with fish: the school nearest the beach in water deep enough
    // to swim round, seen from the open sea side.
    const near = (a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z);
    const deep = ocean.schools.filter((sc) => sc.floor < level - 10);
    const reef = [...(deep.length ? deep : ocean.schools)].sort(near)[0];
    if (reef) {
      // Where the fish swim (as ocean.js puts them).
      const bottom = reef.floor + 1.2, top = level - 1.2;
      s.reef = { ...reef, fishY: bottom + (top - bottom) * reef.depthMix, out: Math.atan2(reef.z - sp.z, reef.x - sp.x) };
    }
    // A bahay kubo inland, where one fits.
    const kx = sp.x - sx * 22, kz = sp.z - sz * 22;
    const turn = [0, 1, 2, 3].reduce((best, k) => (SIDES[k][0] * sx + SIDES[k][1] * sz > SIDES[best][0] * sx + SIDES[best][1] * sz ? k : best), 0);
    for (let d = 0; d < 16 && !s.kubo; d++) {
      for (let a = 0; a < 8 && !s.kubo; a++) {
        const ci = Math.round((kx + Math.cos(a) * d * 2) / CELL) - 1, cj = Math.round((kz + Math.sin(a) * d * 2) / CELL) - 1;
        const fit = building.kuboFits(ci, cj, turn);
        if (fit.ok) s.kubo = { i0: ci, j0: cj, turn, deck: fit.deck, x: (ci + 1) * CELL, z: (cj + 1) * CELL };
      }
    }
    return s;
  }

  // The nearest standing tree inland, not too close.
  function nearestTree() {
    const sp = player.spawn;
    const trees = vegetation.sources.trees.filter((tr) => !tr.felled && Math.hypot(tr.x - sp.x, tr.z - sp.z) > 10 && terrain.slopeAt(tr.x, tr.z) < 0.25);
    trees.sort((a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z));
    return trees[0];
  }

  // Bed wars: the bahay kubo with Pula's bed inside, and Asul's on the
  // highest ground round it, with the way across dry land Pula charges in
  // by (site.bed: { x, z, run: [x, z] towards the bed }). Once.
  function setUpWars() {
    if (!site.kubo || beds) return;
    const k = site.kubo, level = seaY() + 0.4, steps = 24;
    building.buildKubo(k, { team: 0 });
    beds = new Beds(scene, terrain, building, findBases(terrain), [0, 1, 2, 3]);
    beds.place(0, { x: k.x, y: k.deck, z: k.z, yaw: 0 });
    let bed = null;
    for (let n = 0; n < steps; n++) {
      const a = (n / steps) * Math.PI * 2, x = k.x + Math.cos(a) * 9, z = k.z + Math.sin(a) * 9;
      if (!bed || ground(x, z) > ground(bed.x, bed.z)) bed = { x, z };
    }
    // Coming in from where the ground stays highest, 4 to 12 m out.
    let best = -Infinity;
    for (let n = 0; n < steps; n++) {
      const a = (n / steps) * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a);
      const low = Math.min(...[4, 8, 12].map((d) => ground(bed.x + ux * d, bed.z + uz * d)));
      if (low > best) [best, bed.run] = [low, [-ux, -uz]];
    }
    if (best < level) bed.run = site.side;   // nowhere dry: as before
    site.bed = bed;
    beds.place(1, { x: bed.x, y: null, z: bed.z, yaw: Math.atan2(bed.run[0], bed.run[1]) });
  }

  // The house on stilts, a piece at a time: pilings, floors, walls (a
  // door facing the land), roofs. Returns them in building order.
  function housePieces() {
    const { i0, j0, top } = site.house, list = [];
    const cells = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => [i0 + a, j0 + b]);
    const low = (i, j) => Math.min(ground(i * CELL, j * CELL), ground((i + 1) * CELL, (j + 1) * CELL));
    for (const [i, j] of cells) list.push({ key: `pilings:${i},${j}`, plan: { type: 'pilings', i, j, top, low: low(i, j), dir: (i + j) % 2 } });
    for (const [i, j] of cells) list.push({ key: `floor:${i},${j}`, plan: { type: 'floor', i, j, y: top + DECK, onPilings: true, dir: 0 } });
    const landSide = [0, 1, 2, 3].reduce((best, k) => (SIDES[k][0] * site.land[0] + SIDES[k][1] * site.land[1] > SIDES[best][0] * site.land[0] + SIDES[best][1] * site.land[1] ? k : best), 0);
    let door = false;
    for (const [i, j] of cells) {
      for (let side = 0; side < 4; side++) {
        const [di, dj] = SIDES[side];
        if (cells.some(([a, b]) => a === i + di && b === j + dj)) continue;   // inside the house
        const type = side === landSide && !door ? 'door' : side === (landSide + 2) % 4 ? 'window' : 'wall';
        if (type === 'door') door = true;
        list.push({ key: `edge:${EDGE_KEYS(i, j)[side]}`, plan: { type, i, j, side, y: top + DECK } });
      }
    }
    for (const [i, j] of cells) list.push({ key: `roof:${i},${j}`, plan: { type: 'roof', i, j, y: top + DECK + WALL_HEIGHT, dir: 0 } });
    return list;
  }
  const raise = (piece) => {
    building.apply({ op: 'place', key: piece.key, plan: piece.plan });
    building.apply({ op: 'state', key: piece.key, added: 99, done: true });
  };

  // --- The shots: duration (s), start(), update(u: 0..1, s: seconds in),
  // and what's written over them: { from, to, text, kicker, center }.
  const shots = [
    {
      // Cold open: high over a lone survivor on the beach, coming down.
      duration: 7,
      start() {
        time(6.9);
        weatherTo('clear');
        put(0, site.x, site.z, site.yaw).model.hold('axe');   // the lone survivor, axe in hand
      },
      update(u) {
        const h = mix(48, 9, ease(u)), a = site.yaw + 0.5 * u, gy = ground(site.x, site.z);
        look(site.x + Math.sin(a) * 0.6, gy + h, site.z + Math.cos(a) * 0.6, site.x, gy, site.z);
      },
      text: [{ from: 3.2, to: 6.8, center: 'EVERY TREE YOU FELL' }],
    },
    {
      // Behind them, the sea ahead.
      duration: 4,
      update(u, s) {
        const [sx, sz] = site.sea, back = mix(4.5, 3.4, u), gy = ground(site.x, site.z);
        look(site.x - sx * back + site.side[0] * 0.8, gy + 1.5, site.z - sz * back + site.side[1] * 0.8, site.x + sx * 30, gy + 1.2, site.z + sz * 30);
      },
      text: [{ from: 0.4, to: 3.9, center: 'BRINGS THE SEA CLOSER' }],
    },
    {
      // Walking inland through the grass, axe in hand.
      duration: 6,
      hand: 'axe',
      start() { hideActors(); },
      update(u, s) {
        const [lx, lz] = site.land, d = mix(2, 10, u), x = site.x + lx * d, z = site.z + lz * d;
        const y = ground(x, z) + EYE + Math.sin(s * 9) * 0.03;
        look(x, y, z, x + lx * 10, y + 0.6, z + lz * 10);
      },
      text: [{ from: 0.4, to: 5.8, text: 'SURVIVE THE ISLAND', kicker: 'GATHER · CRAFT · EAT' }],
    },
    {
      // Felling a tree: the axe bites, and it comes down.
      duration: 8,
      hand: 'axe',
      background: 0.6,
      start() {
        const tr = site.tree;
        if (!tr) return;
        const [done, needed] = timber.chopProgress(tr);
        tr.chops = Math.max(done, needed - 3);
        const dx = tr.x - site.x, dz = tr.z - site.z, d = Math.hypot(dx, dz);
        this.from = { x: tr.x - (dx / d) * 1.9, z: tr.z - (dz / d) * 1.9 };
        this.swings = [0.5, 1.15, 1.8];
      },
      update(u, s) {
        const tr = site.tree, f = this.from;
        if (!tr) return;
        const y = ground(f.x, f.z) + EYE;
        while (this.swings.length && s >= this.swings[0]) {
          this.swings.shift();
          player.pos.set(f.x, y - EYE, f.z);
          held.swing(() => timber.chop(tr, player.pos));
        }
        const lift = s > 2.4 ? ease(clamp01((s - 2.4) / 3)) : 0;
        look(f.x, y, f.z, tr.x, ground(tr.x, tr.z) + 1.2 + lift * 1.5, tr.z);
      },
      text: [{ from: 0.3, to: 4.2, text: 'FELL TREES' }, { from: 4.3, to: 7.8, text: 'EVERY ONE STIRS THE CLIMATE' }],
    },
    {
      // A house on stilts going up over the shallows.
      duration: 8,
      start() { this.pieces = housePieces(); },
      update(u, s) {
        while (this.pieces.length && s >= 0.3 + (20 - this.pieces.length) * 0.27) raise(this.pieces.shift());
        const hs = site.house, a = Math.atan2(site.land[0], site.land[1]) + 0.9 - u * 1.1, y = hs.top + 1.5;
        look(hs.x + Math.sin(a) * 11, y, hs.z + Math.cos(a) * 11, hs.x, hs.top + 0.8, hs.z);
      },
      text: [{ from: 0.4, to: 7.8, text: 'BUILD ON STILTS', kicker: 'ABOVE WHERE THE SEA WILL REACH' }],
    },
    {
      // Under the sea: gliding past the reef and its fish.
      duration: 6,
      start() { time(8); },
      update(u) {
        const r = site.reef;
        if (!r) return;
        const a = r.out - 0.5 + u * 1, rad = r.radius + 5;
        const x = r.x + Math.cos(a) * rad, z = r.z + Math.sin(a) * rad;
        const y = Math.max(r.fishY + 0.3, ground(x, z) + 1.2);
        look(x, y, z, r.x, r.fishY - 0.6, r.z);
      },
      text: [{ from: 0.4, to: 5.8, text: 'DIVE THE REEF' }],
    },
    {
      // The climate answers: a storm rolls in over the house, hours in seconds, and the sea comes up.
      duration: 9,
      start() {
        time(10);
        weatherTo('storm', 0.95, 4);
      },
      update(u) {
        time(mix(10, 15, u));
        sea.rise = mix(0, 1.2, u);
        sea.surge = 0;
        const hs = site.house, [lx, lz] = site.land, [ax, az] = site.side;
        const x = hs.x + lx * 15 + ax * 7, z = hs.z + lz * 15 + az * 7;
        look(x, Math.max(ground(x, z), seaY()) + 2.4, z, hs.x, hs.top - 1, hs.z);
      },
      text: [{ from: 0.4, to: 4.4, text: 'THE CLIMATE ANSWERS' }, { from: 4.6, to: 8.8, text: 'STORMS GROW · THE SEA RISES' }],
    },
    {
      // The flood across the beach, the house dry above it.
      duration: 6,
      update(u, s) {
        sea.rise = mix(1.2, 2.3, u);
        sea.surge = 0;
        const sh = site.shore, [lx, lz] = site.land, [ax, az] = site.side;
        const x = sh.x + lx * 6 + ax * 5, z = sh.z + lz * 6 + az * 5;
        water.surface(x, z, uniforms.uTime.value, surf);
        look(x, Math.max(ground(x, z) + 0.4, surf.height + 0.7), z, site.house.x, site.house.top, site.house.z);
      },
      text: [{ from: 0.4, to: 5.8, text: 'BUILD HIGH, OR WASH AWAY' }],
    },
    {
      // Bed wars: four teams round a bahay kubo, spears flying.
      duration: 9,
      background: 0.5,
      start() {
        time(9);
        weatherTo('overcast');
        sea.rise = 0.2;
        setUpWars();
        for (let i = 0; i < 4; i++) actor(i).model.hold('spear');
        this.throws = [[1.2, 1, 0], [2.4, 2, 3], [3.5, 3, 1], [5.0, 0, 2], [6.4, 2, 1], [7.6, 1, 3]];
      },
      update(u, s) {
        const k = site.kubo ?? site.house;
        for (let i = 0; i < 4; i++) {
          const r = 7 + i * 1.3, a = s * (0.55 - i * 0.07) * (i % 2 ? -1 : 1) + i * 1.6;
          const x = k.x + Math.cos(a) * r, z = k.z + Math.sin(a) * r;
          // Running round, facing the way they go.
          const turning = i % 2 ? -1 : 1;
          put(i, x, z, Math.atan2(Math.sin(a) * turning, -Math.cos(a) * turning), 4);
        }
        while (this.throws.length && s >= this.throws[0][0]) {
          const [, from, to] = this.throws.shift();
          actor(from).model.swing();
          throwSpear(handOf(from), chestOf(to), 0.8);
        }
        const a = 0.6 + u * 0.5, y = (site.kubo?.deck ?? 3) + 1.8;
        look(k.x + Math.cos(a) * 14, y, k.z + Math.sin(a) * 14, k.x, y - 2.2, k.z);
      },
      text: [{ from: 0.4, to: 8.8, text: 'BED WARS FOR FOUR TEAMS', kicker: 'PULA · ASUL · BERDE · DILAW' }],
    },
    {
      // Up close: a charge on Asul's bed, spears flying back.
      duration: 7,
      background: 0.45,
      start() {
        weatherTo('rain', 0, 1);
        setUpWars();
        actor(0).model.hold('pickaxe');   // the bed breaker
        for (let i = 1; i < 4; i++) actor(i).model.hold('spear');
        this.throws = [[0.8, 1, 0], [1.6, 2, 0], [2.6, 3, 0], [4.6, 1, 0]];
        this.broken = this.struck = false;
      },
      update(u, s) {
        const bed = site.bed;
        if (!bed) return;
        const [ax, az] = bed.run, [px, pz] = [-az, ax];   // the way Red runs, and across it
        // Red runs at the bed; the others close in from beyond and the sides.
        const run = clamp01(s / 3);
        const rx = mix(bed.x - ax * 12, bed.x - ax * 1.3, run), rz = mix(bed.z - az * 12, bed.z - az * 1.3, run);
        put(0, rx, rz, Math.atan2(-ax, -az), run < 1 ? 5 : 0);
        put(1, bed.x + ax * 4 + px * 5, bed.z + az * 4 + pz * 5, Math.atan2(ax + px, az + pz), 1);
        put(2, bed.x + ax * 7, bed.z + az * 7, Math.atan2(ax, az), 2);
        put(3, bed.x + ax * 2 - px * 6, bed.z + az * 2 - pz * 6, Math.atan2(ax - px, az - pz), 2);
        while (this.throws.length && s >= this.throws[0][0]) {
          const [, from] = this.throws.shift();
          actor(from).model.swing();
          throwSpear(handOf(from), chestOf(0), 0.7);
        }
        if (!this.struck && s > 3.25) {
          this.struck = true;
          actor(0).model.swing();
        }
        if (!this.broken && s > 3.6) {
          this.broken = true;
          beds?.destroy(1);
          audio.wood('break', 1);
        }
        const cx = rx - ax * 4 + px * 2.5, cz = rz - az * 4 + pz * 2.5;
        look(cx, Math.max(ground(cx, cz), seaY() + 0.5) + 2.2, cz, bed.x, ground(bed.x, bed.z) + 0.6, bed.z);
      },
      text: [
        { from: 0.3, to: 3.7, text: 'BREAK THEIR BEDS' },
        { from: 3.6, to: 6.8, feed: 'Team Asul’s bed was destroyed by Juan' },
        { from: 3.8, to: 6.8, text: 'KEEP YOURS ABOVE THE FLOOD' },
      ],
    },
    {
      // The title, over a storm at dusk on the open sea.
      duration: 11,
      start() {
        hideActors();
        time(17.6);
        weatherTo('storm', 0.95, 0.5);
        sea.rise = 1;
      },
      update(u) {
        const [sx, sz] = site.sea, d = mix(70, 52, u);
        const x = site.x + sx * d + site.side[0] * 10, z = site.z + sz * d + site.side[1] * 10;
        water.surface(x, z, uniforms.uTime.value, surf);
        look(x, surf.height + 3.2, z, site.x, ground(site.x, site.z) + 6, site.z);
      },
      text: [{ from: 1, to: 11, title: true }],
    },
  ];
  const total = shots.reduce((sum, s) => sum + s.duration, 0);

  // --- Drawing a frame: the game, then the words over it.
  function caption(text, kicker, alpha) {
    g2.save();
    g2.globalAlpha = alpha;
    g2.font = '900 76px system-ui, "Segoe UI", sans-serif';
    g2.letterSpacing = '2px';
    const x = 110, y = H - 150, w = g2.measureText(text).width;
    g2.fillStyle = 'rgba(0, 0, 0, 0.55)';
    g2.fillRect(x - 30, y - 82, w + 60, kicker ? 150 : 110);
    g2.fillStyle = GREEN;
    g2.fillRect(x - 30, y - 82, 10, kicker ? 150 : 110);
    g2.fillStyle = '#fff';
    g2.fillText(text, x, y);
    if (kicker) {
      g2.font = '700 30px system-ui, "Segoe UI", sans-serif';
      g2.letterSpacing = '6px';
      g2.fillStyle = '#cfe8d6';
      g2.fillText(kicker, x + 2, y + 50);
    }
    g2.restore();
  }
  // A line of the match feed, top right, as the game shows it.
  function feed(text, alpha) {
    g2.save();
    g2.globalAlpha = alpha;
    g2.font = '600 34px system-ui, "Segoe UI", sans-serif';
    g2.textAlign = 'right';
    const x = W - 90, y = 150, w = g2.measureText(text).width;
    g2.fillStyle = 'rgba(0, 0, 0, 0.55)';
    g2.fillRect(x - w - 24, y - 42, w + 48, 60);
    g2.fillStyle = '#fff';
    g2.fillText(text, x, y);
    g2.restore();
  }
  function center(text, alpha) {
    g2.save();
    g2.globalAlpha = alpha;
    g2.font = '800 84px system-ui, "Segoe UI", sans-serif';
    g2.letterSpacing = '10px';
    g2.textAlign = 'center';
    g2.shadowColor = 'rgba(0, 0, 0, 0.7)';
    g2.shadowBlur = 24;
    g2.fillStyle = '#fff';
    g2.fillText(text, W / 2, H / 2 + 28);
    g2.restore();
  }
  function title(s) {
    const grad = g2.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.15)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, W, H);
    g2.save();
    g2.textAlign = 'center';
    g2.shadowColor = 'rgba(0, 0, 0, 0.8)';
    g2.shadowBlur = 30;
    g2.globalAlpha = clamp01(s / 1.2);
    g2.font = '900 150px system-ui, "Segoe UI", sans-serif';
    g2.letterSpacing = '18px';
    g2.fillStyle = '#fff';
    g2.fillText('WASHED AWAY', W / 2, H / 2 - 10);
    g2.globalAlpha = clamp01((s - 1.6) / 1);
    g2.font = 'italic 500 40px system-ui, "Segoe UI", sans-serif';
    g2.letterSpacing = '2px';
    g2.fillStyle = '#d7e3ea';
    g2.fillText('Every tree you fell brings the sea closer.', W / 2, H / 2 + 60);
    g2.globalAlpha = clamp01((s - 3.4) / 1);
    g2.font = '800 40px system-ui, "Segoe UI", sans-serif';
    g2.letterSpacing = '8px';
    g2.fillStyle = GREEN;
    g2.fillText('PLAY FREE IN YOUR BROWSER', W / 2, H - 190);
    g2.font = '600 36px system-ui, "Segoe UI", sans-serif';
    g2.letterSpacing = '1px';
    g2.fillStyle = '#fff';
    g2.fillText('washed-away.onrender.com', W / 2, H - 135);
    g2.restore();
  }

  function frame() {
    if (!running) return;
    g2.drawImage(renderer.domElement, 0, 0, W, H);
    const s = shots[shot];
    for (const c of s?.text ?? []) {
      if (local < c.from || local > c.to) continue;
      const alpha = Math.min(clamp01((local - c.from) / 0.35), clamp01((c.to - local) / 0.35));
      if (c.title) title(local - c.from);
      else if (c.center) center(c.center, alpha);
      else if (c.feed) feed(c.feed, alpha);
      else caption(c.text, c.kicker, alpha);
    }
    // In from black at the start, out to black at the end.
    const fade = Math.max(clamp01(1 - t / 0.8), clamp01((t - (total - 1.6)) / 1.5));
    if (fade > 0) {
      g2.fillStyle = `rgba(0, 0, 0, ${fade})`;
      g2.fillRect(0, 0, W, H);
    }
  }

  function finish() {
    running = false;
    document.body.classList.remove('trailer');
    out.hidden = true;
    hideActors();
    camera.fov = 70;
    camera.updateProjectionMatrix();
    weather.hold = false;
    audio.background = 1;
    const done = (file) => onEnd?.(file);
    if (!recorder) return done(null);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const url = URL.createObjectURL(blob);
      const ext = recorder.mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
      const link = Object.assign(document.createElement('a'), { href: url, download: `washed-away-trailer.${ext}` });
      document.body.append(link);
      link.click();
      link.remove();
      done({ size: blob.size, type: recorder.mimeType, url });
      recorder = null;
    };
    recorder.stop();
  }

  return {
    get running() { return running; },
    get length() { return total; },
    get shot() { return shot; },
    get site() { return site; },

    // Plays it from the start (or from `from` seconds in, to look at one
    // shot); record: also records it to a file, which downloads at the end.
    // ended(file) is called then ({ size, type, url } when recorded).
    play({ record = false, from = 0 } = {}, ended = null) {
      onEnd = ended;
      site ??= findSites();
      if (!site.tree || site.tree.felled) site.tree = nearestTree();
      sea.rise = 0;
      t = from;
      shot = -1;
      running = true;
      document.body.classList.add('trailer');
      out.hidden = false;
      inventory.add('axe', 1);
      camera.fov = 60;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      if (record) {
        const stream = out.captureStream(60);
        if (audio.ctx) {
          const dest = audio.ctx.createMediaStreamDestination();
          audio.muffle.connect(dest);   // as you hear it: muffled under water
          for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
        }
        const type = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus'].find((m) => MediaRecorder.isTypeSupported(m));
        chunks = [];
        recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16_000_000, audioBitsPerSecond: 192_000 });
        recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        recorder.start(1000);
      }
    },

    // Every frame instead of your own movement: the shot moves the camera.
    update(dt) {
      if (!running) return;
      t += dt;
      let start = 0, i = 0;
      while (i < shots.length && t >= start + shots[i].duration) start += shots[i++].duration;
      if (i >= shots.length) {
        finish();
        return;
      }
      if (i !== shot) {
        shot = i;
        hand(shots[i].hand);   // empty-handed but for the first-person shots
        audio.background = shots[i].background ?? 1;   // quieter wind and rain where there's action to hear
        shots[i].start?.call(shots[i]);
      }
      local = t - start;
      shots[i].update.call(shots[i], local / shots[i].duration, local);
      for (const a of actors) if (a?.model.object.visible) a.model.update(dt, a.speed);
      // You're where the camera is: for the sea's look from below, the
      // grass and the sound.
      const c = camera.position;
      water.surface(c.x, c.z, uniforms.uTime.value, surf);
      player.underwater = c.y < surf.height - 0.05;
      player.depth = Math.max(0, surf.height - c.y);
      player.pos.set(c.x, c.y - EYE, c.z);
    },

    frame,
  };
}
