import * as THREE from 'three';
import { TEAMS } from './teams.js';
import { PlayerModel } from '../player/playerModel.js';
import { patchMaterial } from '../world/materials.js';
import { itemOf } from '../items/items.js';

const DELAY = 0.1;   // seconds: others are drawn this far behind, between two updates
const LOST = 1;      // seconds without news before someone is hidden
const RADIUS = 0.45; // metres: how wide a body is to a swing

const lerp = (a, b, t) => a + (b - a) * t;
const turn = (a, b, t) => a + ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI) * t;

// A name over someone's head, in their team's colour.
function nameTag(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = color;
  ctx.fillText(name, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.15;
  return sprite;
}

// The other players in a match, as low-poly survivors in their team's
// colour (player/playerModel.js) with their names over their heads. Their
// games send where they are 20 times a second (through the server); each is
// drawn a tenth of a second behind, moving smoothly between the two updates
// either side of that moment, walking in step with their speed, with what's
// in their hand, swinging it when they do.
export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map();   // by id: { id, name, team, model, updates: [{ t, s }] }
  }

  // players: the match's ([{ id, name, team }]); me: your id (not drawn).
  add(players, me) {
    for (const p of players) {
      if (p.id === me || this.players.has(p.id)) continue;
      const material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { key: 'player-model', snowMin: 0.95 });
      const model = new PlayerModel(TEAMS[p.team].color, { material });
      model.object.add(nameTag(p.name, TEAMS[p.team].color));
      model.object.visible = false;
      this.scene.add(model.object);
      this.players.set(p.id, { ...p, model, updates: [] });
    }
  }

  // The server's update: { id: [x, y, z, yaw, speed, held, acts] } (held:
  // what's in their hand, items/items.js itemCode(), negative while a spear
  // is drawn back; acts: their swings and throws so far).
  receive(update) {
    const t = performance.now() / 1000;
    for (const [id, s] of Object.entries(update)) {
      const p = this.players.get(id);
      if (!p) continue;
      p.updates.push({ t, s });
      if (p.updates.length > 8) p.updates.shift();
    }
  }

  // Gone down (until they're back) or out.
  hide(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.updates.length = 0;
    p.model.object.visible = false;
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.model.object);
    p.model.dispose();
    this.players.delete(id);
  }

  update(dt) {
    const now = performance.now() / 1000, t = now - DELAY;
    for (const p of this.players.values()) {
      const u = p.updates, object = p.model.object;
      if (!u.length || now - u[u.length - 1].t > LOST) {
        object.visible = false;
        continue;
      }
      // The two updates either side of t (or the latest, if t is past it).
      let a = u[u.length - 1], b = a;
      for (let i = u.length - 1; i > 0; i--) {
        if (u[i - 1].t <= t) {
          a = u[i - 1];
          b = u[i];
          break;
        }
      }
      const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
      object.position.set(lerp(a.s[0], b.s[0], k), lerp(a.s[1], b.s[1], k), lerp(a.s[2], b.s[2], k));
      object.rotation.y = turn(a.s[3], b.s[3], k);
      const latest = u[u.length - 1].s, held = latest[5] ?? 0, acts = latest[6] ?? 0;
      p.model.hold(itemOf(held));
      p.model.drawn = held < 0;
      if (p.acts !== undefined && acts !== p.acts) p.model.swing();
      p.acts = acts;
      p.model.update(dt, lerp(a.s[4], b.s[4], k));
      object.visible = true;
    }
  }

  // Who a swing along ray (from your eye) would hit within reach: the
  // nearest player whose body (a standing column) it passes through, as
  // { id, name, team, distance }, or null.
  aimed(ray, reach) {
    let best = null;
    const o = ray.origin, d = ray.direction, flat = d.x * d.x + d.z * d.z;
    if (flat < 1e-6) return null;
    for (const p of this.players.values()) {
      const at = p.model.object.position;
      if (!p.model.object.visible) continue;
      // Where the ray comes closest to the body's axis, seen from above.
      const t = ((at.x - o.x) * d.x + (at.z - o.z) * d.z) / flat;
      if (t < 0 || t > reach) continue;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (Math.hypot(x - at.x, z - at.z) > RADIUS || y < at.y || y > at.y + 1.9) continue;
      if (!best || t < best.distance) best = { id: p.id, name: p.name, team: p.team, distance: t };
    }
    return best;
  }
}
