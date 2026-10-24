import * as THREE from 'three';
import { TEAMS, BASE_RADIUS } from '../match/teams.js';

const R = 310;           // metres shown either side of the middle: the island and its islet
const S = 620;           // map pixels across (one a metre)
const M = (2 * R) / S;   // metres a pixel
const REFRESH = 0.25;    // seconds between redraws while it's open

// Colours (r, g, b) by height above the sea, and by depth under it.
const SAND = [214, 200, 152], GRASS = [112, 156, 76], FOREST = [80, 126, 58], HILL = [122, 118, 86], ROCK = [160, 154, 140];
const SHALLOW = [64, 156, 176], DEEP = [22, 70, 98];
const WOOD = '#c89a62';

// rgb = a + (b - a) * t, with t clamped to 0..1.
function mix(rgb, a, b, t) {
  t = Math.min(1, Math.max(0, t));
  for (let k = 0; k < 3; k++) rgb[k] = a[k] + (b[k] - a[k]) * t;
  return rgb;
}

// The map (K): the island from above, drawn from the terrain itself, north
// up. It shows the sea where it is now (it rises, and it floods the
// beaches), the trees still standing (felled ones are gone from it), what
// you've built, the team bases in a multiplayer match, and you, pointing
// the way you face. It stays up while you move, redrawn a few times a
// second.
export class MapUI {
  // trees: the vegetation's trees; match: the multiplayer match, or null.
  constructor({ terrain, trees, building, sea, climate, match }) {
    Object.assign(this, { terrain, trees, building, sea, climate, match });
    this.el = document.getElementById('map');
    this.canvas = document.getElementById('map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.info = document.getElementById('map-info');
    this.legend = document.getElementById('map-legend');
    this.open = false;
    this.timer = 0;
    // The ground, sampled the first time the map opens, then coloured for
    // the sea level whenever that has moved.
    this.heights = null;
    this.shade = null;
    this.ground = document.createElement('canvas');
    this.ground.width = this.ground.height = S;
    this.groundLevel = NaN;
    this.dir = new THREE.Vector3();
  }

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  show() {
    this.open = true;
    this.el.hidden = false;
    this.timer = 0;
    this.showLegend();
  }

  close() {
    this.open = false;
    this.el.hidden = true;
  }

  // Every frame (dt in seconds): redraws now and then while it's open.
  update(dt, player, camera) {
    if (!this.open || (this.timer -= dt) > 0) return;
    this.timer = REFRESH;
    this.draw(player, camera);
  }

  showLegend() {
    const items = [['#fff', 'You'], ['#1c401e', 'Trees'], [WOOD, 'What you’ve built']];
    if (this.match?.bases) items.push(['transparent', 'Team bases']);
    this.legend.replaceChildren(...items.map(([color, text]) => {
      const item = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = color;
      if (color === 'transparent') swatch.style.border = '2px solid var(--accent)';
      item.append(swatch, text);
      return item;
    }));
  }

  // The terrain, lit from the north-west, with the sea at `level`.
  paintGround(level) {
    if (!this.heights) {
      const heights = new Float32Array(S * S), shade = new Float32Array(S * S);
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) heights[j * S + i] = this.terrain.heightAt(-R + (i + 0.5) * M, -R + (j + 0.5) * M);
      }
      const at = (i, j) => heights[Math.min(S - 1, Math.max(0, j)) * S + Math.min(S - 1, Math.max(0, i))];
      for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
          // Slopes facing the light (rising to the south-east) are brighter.
          const rise = (at(i + 1, j) - at(i - 1, j) + at(i, j + 1) - at(i, j - 1)) / (2 * M);
          shade[j * S + i] = Math.min(1.3, Math.max(0.55, 1 + 0.7 * rise));
        }
      }
      this.heights = heights;
      this.shade = shade;
    }
    const ctx = this.ground.getContext('2d');
    const image = ctx.createImageData(S, S), data = image.data, rgb = [0, 0, 0];
    for (let k = 0; k < S * S; k++) {
      const h = this.heights[k] - level;
      if (h < 0) {
        mix(rgb, SHALLOW, DEEP, -h / 10);
      } else {
        if (h < 1.3) mix(rgb, SAND, SAND, 0);
        else if (h < 12) mix(rgb, GRASS, FOREST, (h - 1.3) / 10);
        else if (h < 26) mix(rgb, FOREST, HILL, (h - 12) / 14);
        else mix(rgb, HILL, ROCK, (h - 26) / 20);
        for (let c = 0; c < 3; c++) rgb[c] *= this.shade[k];
      }
      data[k * 4] = rgb[0];
      data[k * 4 + 1] = rgb[1];
      data[k * 4 + 2] = rgb[2];
      data[k * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    this.groundLevel = level;
  }

  draw(player, camera) {
    const level = this.sea.level;
    if (!this.heights || Math.abs(level - this.groundLevel) > 0.02) this.paintGround(level);
    const ctx = this.ctx;
    const px = (x) => (x + R) / M;
    ctx.drawImage(this.ground, 0, 0);

    // The trees still standing.
    ctx.fillStyle = 'rgba(28, 64, 30, 0.8)';
    ctx.beginPath();
    for (const t of this.trees) {
      if (t.felled) continue;
      const r = Math.max(1, 1.4 * t.s);
      ctx.moveTo(px(t.x) + r, px(t.z));
      ctx.arc(px(t.x), px(t.z), r, 0, Math.PI * 2);
    }
    ctx.fill();

    // What you've built: blueprints in outline.
    const { cells, edges, size } = this.building.layout();
    ctx.lineWidth = 1.5;
    for (const c of cells) {
      ctx.fillStyle = WOOD;
      ctx.strokeStyle = WOOD;
      if (c.done) ctx.fillRect(px(c.x), px(c.z), size / M, size / M);
      else ctx.strokeRect(px(c.x) + 0.5, px(c.z) + 0.5, size / M - 1, size / M - 1);
    }
    ctx.lineWidth = 2;
    for (const e of edges) {
      ctx.strokeStyle = e.done ? '#6b4a26' : WOOD;
      ctx.beginPath();
      ctx.moveTo(px(e.ax), px(e.az));
      ctx.lineTo(px(e.bx), px(e.bz));
      ctx.stroke();
    }

    // Team bases, in a multiplayer match, ringed by their barriers while
    // the build phase lasts.
    const bases = this.match?.bases;
    if (bases) {
      ctx.font = '600 12px system-ui, sans-serif';
      bases.forEach((b, i) => {
        const team = TEAMS[i], x = px(b.x), y = px(b.z), ours = team === this.match.team;
        if (this.match.barriersUp) {
          ctx.setLineDash([6, 5]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = team.color;
          ctx.fillStyle = `${team.color}26`;
          ctx.beginPath();
          ctx.arc(x, y, BASE_RADIUS / M, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = team.color;
        ctx.lineWidth = ours ? 3 : 2;
        ctx.beginPath();
        ctx.arc(x, y, ours ? 9 : 7, 0, Math.PI * 2);
        ctx.stroke();
        const label = ours ? `${team.name} · your base` : team.name;
        const w = ctx.measureText(label).width;
        const lx = b.x > 0 ? x - w - 12 : x + 12, ly = y + 4;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = team.color;
        ctx.fillText(label, lx, ly);
      });
    }

    // You, pointing the way you face.
    camera.getWorldDirection(this.dir);
    const angle = Math.atan2(this.dir.z, this.dir.x);
    ctx.save();
    ctx.translate(px(player.pos.x), px(player.pos.z));
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // North, and a 100 m scale bar.
    ctx.fillStyle = '#fff';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', S / 2, 18);
    ctx.beginPath();
    ctx.moveTo(S / 2, 23);
    ctx.lineTo(S / 2 - 5, 33);
    ctx.lineTo(S / 2 + 5, 33);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillRect(16, S - 20, 100 / M, 3);
    ctx.fillText('100 m', 16, S - 26);

    const here = this.climate.here;
    this.info.textContent = here.land ? here.name : 'At sea';
  }
}
