import * as THREE from 'three';
import { TEAMS } from './teams.js';

const FLY = 12, FAST = 32;       // m/s flying freely (Shift: fast)
const BEHIND = 4.6, ABOVE = 2.4; // metres: following someone, where the camera sits
const LOOK = 1.4;                // ...looking at their shoulders
const EASE = 6;                  // how quickly the camera catches up (per second)

// Watching a match (match/bedwars.js): a camera of your own, nothing more.
// Flying freely, WASD moves the way you look, Space rises, C sinks, Shift
// is faster and the mouse looks around. Click follows the next player still
// in it, from behind and above (again, the one after); right-click flies
// freely again from there. Nobody sees you, and you can't touch anything.
// remotes: the other players (match/remotePlayers.js).
export class Spectator {
  constructor(camera, remotes, terrain) {
    Object.assign(this, { camera, remotes, terrain });
    this.on = false;
    this.following = null;   // the id of whoever you're following
    this.el = document.getElementById('spectate');
    this.dir = new THREE.Vector3();
    this.side = new THREE.Vector3();
    this.want = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.shown = '';
  }

  // Starts watching. From where the camera is, unless `overview`: then high
  // over the island, looking across it.
  start(overview = false) {
    this.on = true;
    this.following = null;
    document.body.classList.add('spectating');
    this.el.hidden = false;
    if (overview) {
      this.camera.position.set(0, 70, 170);
      this.camera.lookAt(0, 8, 0);
    }
  }

  // Everyone you could follow: in the match, up and about.
  get players() { return [...this.remotes.players.values()].filter((p) => p.model.object.visible); }

  // Click: follow the next one along (or the first).
  next(step = 1) {
    const list = this.players;
    if (!list.length) {
      this.following = null;
      return;
    }
    const i = list.findIndex((p) => p.id === this.following);
    this.following = list[(((i < 0 ? -1 : i) + step) % list.length + list.length) % list.length].id;
  }

  // Right-click: fly freely from where you are.
  free() { this.following = null; }

  // Every frame. keys: what's held down (player.keys).
  update(dt, keys) {
    if (!this.on) return;
    const cam = this.camera;
    const who = this.following && this.remotes.players.get(this.following);
    if (who && !who.model.object.visible) this.next();   // they went down: on to the next
    const p = this.following && this.remotes.players.get(this.following);
    if (p) {
      // Behind them, the way they face, and a little above.
      const at = p.model.object.position, yaw = p.model.object.rotation.y;
      this.want.set(at.x + Math.sin(yaw) * BEHIND, at.y + ABOVE, at.z + Math.cos(yaw) * BEHIND);
      this.want.y = Math.max(this.want.y, this.terrain.heightAt(this.want.x, this.want.z) + 0.6);
      cam.position.lerp(this.want, Math.min(1, dt * EASE));
      this.target.set(at.x, at.y + LOOK, at.z);
      cam.lookAt(this.target);
    } else {
      cam.getWorldDirection(this.dir);
      this.side.crossVectors(this.dir, cam.up).normalize();
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? FAST : FLY) * dt;
      const ahead = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const across = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      const up = (keys.has('Space') ? 1 : 0) - (keys.has('KeyC') ? 1 : 0);
      cam.position.addScaledVector(this.dir, ahead * speed).addScaledVector(this.side, across * speed);
      cam.position.y += up * speed;
      cam.position.y = Math.max(cam.position.y, this.terrain.heightAt(cam.position.x, cam.position.z) + 0.5);
    }
    this.label(p);
  }

  // The line at the bottom of the screen: who you're watching, and the keys.
  label(p) {
    const text = p
      ? `Watching ${p.name} · Team ${TEAMS[p.team].name}\u0000Click: next player · Right-click: fly freely`
      : `Flying freely\u0000Click: follow a player · WASD, Space and C: fly · Shift: faster`;
    if (text === this.shown) return;
    this.shown = text;
    const [head, keys] = text.split('\u0000');
    this.el.replaceChildren(Object.assign(document.createElement('b'), { textContent: head }), Object.assign(document.createElement('span'), { textContent: keys }));
    if (p) this.el.firstChild.style.color = TEAMS[p.team].color;
  }
}
