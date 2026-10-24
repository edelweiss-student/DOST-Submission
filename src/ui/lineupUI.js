import * as THREE from 'three';
import { TEAMS } from '../match/teams.js';
import { PlayerModel } from '../player/playerModel.js';

const SPACING = 0.8;   // metres between players in the line-up

// Everyone in the multiplayer lobby, standing in a row in their team's
// colour (grouped by team, in the order they joined), with a marker over
// you. It has its own small canvas and renderer, and only draws while it's
// on screen.
export class Lineup {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.scene.add(new THREE.HemisphereLight('#d8ecff', '#6b5844', 1.8));
    const sun = new THREE.DirectionalLight('#fff3df', 2.6);
    sun.position.set(-2, 4, 5);
    this.scene.add(sun);
    this.models = new Map();   // by player id: { model, team }
    // A marker pointing down at you.
    this.marker = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.15, 4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.marker.rotation.x = Math.PI;
    this.scene.add(this.marker);
    this.me = null;
    this.count = 0;
    this.running = false;
    this.last = 0;
  }

  // players: the lobby's ([{ id, team }]); me: your id.
  set(players, me) {
    for (const [id, { model }] of this.models) {
      if (players.some((p) => p.id === id)) continue;
      this.scene.remove(model.object);
      model.dispose();
      this.models.delete(id);
    }
    for (const p of players) {
      const entry = this.models.get(p.id);
      if (!entry) {
        const model = new PlayerModel(TEAMS[p.team].color);
        this.models.set(p.id, { model, team: p.team });
        this.scene.add(model.object);
      } else if (entry.team !== p.team) {
        entry.model.setColor(TEAMS[p.team].color);
        entry.team = p.team;
      }
    }
    // Grouped by team (the sort keeps the order they joined in), turned a
    // little to show their packs.
    const row = [...players].sort((a, b) => a.team - b.team);
    row.forEach((p, i) => {
      const { object } = this.models.get(p.id).model;
      object.position.set((i - (row.length - 1) / 2) * SPACING, 0, 0);
      object.rotation.y = Math.PI - 0.35;
    });
    this.me = me;
    this.count = row.length;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now) => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      this.draw(now);
    };
    requestAnimationFrame(tick);
  }

  stop() { this.running = false; }

  draw(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) this.renderer.setSize(w, h, false);
    // Far enough back to fit everyone, and their full height.
    const half = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)), aspect = w / h;
    const across = ((this.count - 1) * SPACING + 0.9) / 2;
    const distance = Math.max(1.15 / half, across / (half * aspect)) + 0.4;
    this.camera.aspect = aspect;
    this.camera.position.set(0, 1.15, distance);
    this.camera.lookAt(0, 0.95, 0);
    this.camera.updateProjectionMatrix();
    for (const { model } of this.models.values()) model.update(dt, 0);
    const mine = this.models.get(this.me)?.model.object;
    this.marker.visible = !!mine;
    if (mine) this.marker.position.set(mine.position.x, 2.08 + 0.04 * Math.sin(now / 300), 0);
    this.renderer.render(this.scene, this.camera);
  }
}
