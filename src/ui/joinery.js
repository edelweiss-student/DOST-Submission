import { jointName } from '../world/building.js';

const $ = (id) => document.getElementById(id);

// The joinery mini-game: when a piece is finished (or reworked later), you
// make its joints in three quick steps. How well they fit (0..1) decides
// how long the piece stands up to weather and sea (see world/building.js).
//   1. Saw the tenon: stop the saw on the pencil line.
//   2. Chisel the mortise: tap to cut deeper and stop inside the marked
//      depth. Go too deep and the joint is loose.
//   3. Drive the pegs: strike as the mallet comes down onto the peg, three times.
// E, Space or a click acts; X skips, leaving rough joints.

const W = 420, H = 210;
const STEPS = [
  { id: 'saw', title: 'Saw the tenon', help: 'Stop the saw on the pencil line.' },
  { id: 'chisel', title: 'Chisel the mortise', help: 'Tap to cut deeper, then stop inside the marked depth. Too deep and the joint is loose.' },
  { id: 'peg', title: 'Drive the pegs', help: 'Strike as the mallet comes down onto the peg. Three strikes.' },
];
const DEPTH = [0.74, 0.88];   // the right depth for the mortise
const SKIPPED = 0.3;          // rough joints, when you skip
const verdict = (s) => (s >= 0.9 ? 'Perfect' : s >= 0.65 ? 'Good' : s >= 0.35 ? 'A little off' : 'Missed');

const WOOD = '#b08154', GRAIN = 'rgba(92, 56, 26, 0.35)', EDGE = '#4a2f19', STEEL = '#c9ced4', ACCENT = '#ffb25b';

export class Joinery {
  constructor(rng) {
    this.rng = rng;
    this.el = { root: $('joinery'), title: $('joinery-title'), step: $('joinery-step'), help: $('joinery-help'), canvas: $('joinery-canvas') };
    this.ctx = this.el.canvas.getContext('2d');
    this.open = false;
  }

  // name: what's being joined; done(quality) once it's over.
  start(name, done) {
    this.open = true;
    this.done = done;
    this.scores = [];
    this.ending = 0;
    this.el.title.textContent = `Joinery: ${name}`;
    this.el.root.hidden = false;
    this.begin(0);
  }

  begin(index) {
    this.index = index;
    const step = STEPS[index];
    this.el.step.textContent = `${index + 1} of 3 · ${step.title}`;
    this.el.help.textContent = step.help;
    this.t = 0;
    this.pause = 0;       // showing how the step went, before the next
    this.word = '';
    this.flash = 0;
    this.mark = 0.25 + this.rng() * 0.5;   // saw: where the pencil line is
    this.cut = null;
    this.depth = 0;                        // chisel
    this.taps = 0;
    this.idle = 0;
    this.strikes = [];                     // pegs
    this.peg = 0;
    this.phase = this.rng() * Math.PI * 2;
  }

  get step() { return STEPS[this.index].id; }
  sawAt() { return 0.5 + 0.42 * Math.sin(this.t * 1.9 + 1.2); }
  malletAngle() { return Math.sin(this.t * 2.3 + this.phase); }

  act() {
    if (!this.open || this.pause > 0 || this.ending > 0) return;
    if (this.step === 'saw') {
      this.cut = this.sawAt();
      this.score(Math.max(0, 1 - Math.abs(this.cut - this.mark) / 0.2));
    } else if (this.step === 'chisel') {
      this.depth = Math.min(1, this.depth + 0.07 + this.rng() * 0.06);
      this.taps++;
      this.idle = 0;
      this.flash = 0.12;
      if (this.depth >= 1) this.score(0.15);
    } else {
      const s = Math.max(0, Math.min(1, 1 - (Math.abs(this.malletAngle()) - 0.06) / 0.3));
      this.strikes.push(s);
      this.peg = Math.min(1, this.peg + 0.2 + 0.14 * s);
      this.flash = 0.15;
      if (this.strikes.length === 3) this.score(this.strikes.reduce((a, b) => a + b) / 3);
    }
  }

  // A step is done: say how it went, then go on.
  score(s) {
    this.scores.push(s);
    this.word = verdict(s);
    this.pause = 0.8;
  }

  // X: skip it, and the joints are rough.
  skip() {
    if (this.open) this.finish(SKIPPED);
  }

  finish(quality) {
    this.open = false;
    this.el.root.hidden = true;
    this.done?.(quality);
  }

  get quality() { return this.scores.reduce((a, b) => a + b, 0) / STEPS.length; }

  // dt: game time (0 while paused, so the mini-game waits too).
  update(dt) {
    if (!this.open) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    if (this.ending > 0) {
      if ((this.ending -= dt) <= 0) this.finish(this.quality);
    } else if (this.pause > 0) {
      if ((this.pause -= dt) <= 0) {
        if (this.scores.length < STEPS.length) this.begin(this.scores.length);
        else this.ending = 1.4;
      }
    } else if (this.step === 'chisel' && this.taps > 0 && (this.idle += dt) > 1.2) {
      // Stopped tapping: how close to the right depth?
      const d = this.depth;
      this.score(d < DEPTH[0] ? Math.max(0, 1 - (DEPTH[0] - d) * 3.5) : d <= DEPTH[1] ? 1 : Math.max(0, 1 - (d - DEPTH[1]) * 7));
    }
    this.draw();
  }

  // --- Drawing.

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = ctx.lineJoin = 'round';
    if (this.ending > 0) {
      this.drawPeg();
      this.banner(`${jointName(this.quality)} joints`, `${Math.round(this.quality * 100)}% fit`);
      return;
    }
    if (this.step === 'saw') this.drawSaw();
    else if (this.step === 'chisel') this.drawChisel();
    else this.drawPeg();
    if (this.pause > 0) this.banner(this.word);
  }

  beam(x, y, w, h) {
    const ctx = this.ctx;
    ctx.fillStyle = WOOD;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = GRAIN;
    ctx.lineWidth = 1.2;
    for (let k = 1; k < 5; k++) {
      const gy = y + (h * k) / 5;
      ctx.beginPath();
      ctx.moveTo(x, gy);
      ctx.bezierCurveTo(x + w * 0.3, gy - 3, x + w * 0.6, gy + 3, x + w, gy - 1);
      ctx.stroke();
    }
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  drawSaw() {
    const ctx = this.ctx;
    const x0 = 50, x1 = 370, y0 = 100, y1 = 160;
    this.beam(x0, y0, x1 - x0, y1 - y0);
    // The pencil line.
    const mx = x0 + this.mark * (x1 - x0);
    ctx.strokeStyle = '#26221f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx, y0 - 6);
    ctx.lineTo(mx, y1 + 6);
    ctx.stroke();
    ctx.fillStyle = '#26221f';
    for (const [y, dir] of [[y0 - 6, 1], [y1 + 6, -1]]) {
      ctx.beginPath();
      ctx.moveTo(mx - 5, y - 6 * dir);
      ctx.lineTo(mx + 5, y - 6 * dir);
      ctx.lineTo(mx, y);
      ctx.fill();
    }
    // The saw: where it is now, or the kerf where you cut.
    const at = this.cut ?? this.sawAt();
    const sx = x0 + at * (x1 - x0);
    if (this.cut !== null) {
      ctx.fillStyle = '#1a120b';
      ctx.fillRect(sx - 1.5, y0, 3, y1 - y0);
    }
    const lift = this.cut !== null ? -30 : 0;
    ctx.fillStyle = STEEL;
    ctx.strokeStyle = '#6f7780';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx - 4, 30 + lift);
    ctx.lineTo(sx + 4, 30 + lift);
    ctx.lineTo(sx + 3, y0 + 4 + lift);
    ctx.lineTo(sx - 3, y0 + 4 + lift);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7a4a26';
    ctx.fillRect(sx - 12, 12 + lift, 24, 20);
  }

  drawChisel() {
    const ctx = this.ctx;
    const x0 = 60, x1 = 300, y0 = 70, y1 = 190, slot = [150, 210];
    this.beam(x0, y0, x1 - x0, y1 - y0);
    const deep = 100;   // pixels at full depth
    ctx.fillStyle = '#1a120b';
    ctx.fillRect(slot[0], y0, slot[1] - slot[0], this.depth * deep);
    // The marked depth, on the beam and on the gauge.
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    for (const d of DEPTH) {
      ctx.beginPath();
      ctx.moveTo(slot[0] - 12, y0 + d * deep);
      ctx.lineTo(slot[0] - 2, y0 + d * deep);
      ctx.moveTo(slot[1] + 2, y0 + d * deep);
      ctx.lineTo(slot[1] + 12, y0 + d * deep);
      ctx.stroke();
    }
    const gx = 340, gw = 18;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(gx, y0, gw, deep);
    ctx.fillStyle = 'rgba(159, 240, 172, 0.35)';
    ctx.fillRect(gx, y0 + DEPTH[0] * deep, gw, (DEPTH[1] - DEPTH[0]) * deep);
    ctx.fillStyle = this.depth > DEPTH[1] ? '#ff8f7a' : ACCENT;
    ctx.fillRect(gx, y0, gw, this.depth * deep);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(gx, y0, gw, deep);
    // The chisel, jumping as you strike it.
    const cx = (slot[0] + slot[1]) / 2, tip = y0 + this.depth * deep - (this.flash > 0 ? 0 : 10);
    ctx.fillStyle = STEEL;
    ctx.fillRect(cx - 9, tip - 46, 18, 46);
    ctx.fillStyle = '#7a4a26';
    ctx.fillRect(cx - 7, tip - 82, 14, 38);
    // Stop tapping to finish: a little timer once you've started.
    if (this.taps > 0 && this.pause <= 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Stop to finish', gx - 30, y1 + 4);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(gx - 30, y1 + 10, 80 * Math.max(0, 1 - this.idle / 1.2), 3);
    }
  }

  drawPeg() {
    const ctx = this.ctx;
    const x0 = 60, x1 = 360, y0 = 140, y1 = 190, px = 210;
    this.beam(x0, y0, x1 - x0, y1 - y0);
    // The peg, driven a bit further in at each strike.
    const out = (1 - this.peg) * 36;
    ctx.fillStyle = '#c99a62';
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 1.5;
    ctx.fillRect(px - 7, y0 - out, 14, out + 4);
    ctx.strokeRect(px - 7, y0 - out, 14, out + 4);
    // Where the mallet has to come down.
    const pivot = { x: px, y: -24 }, arm = y0 - out - 12 - pivot.y;
    ctx.fillStyle = 'rgba(159, 240, 172, 0.18)';
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.arc(pivot.x, pivot.y, arm + 16, Math.PI / 2 - 0.12, Math.PI / 2 + 0.12);
    ctx.fill();
    // The mallet swinging.
    const a = this.ending > 0 ? 0 : this.malletAngle();
    const hx = pivot.x + Math.sin(a) * arm, hy = pivot.y + Math.cos(a) * arm;
    ctx.strokeStyle = '#7a4a26';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-a);
    ctx.fillStyle = this.flash > 0 ? '#e0b47c' : '#9a6a3c';
    ctx.fillRect(-20, -11, 40, 22);
    ctx.strokeStyle = EDGE;
    ctx.strokeRect(-20, -11, 40, 22);
    ctx.restore();
    // Strikes so far.
    this.strikes.forEach((s, k) => {
      ctx.fillStyle = s >= 0.65 ? '#9ff0ac' : s >= 0.35 ? ACCENT : '#ff8f7a';
      ctx.beginPath();
      ctx.arc(30 + k * 18, 24, 6, 0, Math.PI * 2);
      ctx.fill();
    });
    for (let k = this.strikes.length; k < 3; k++) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(30 + k * 18, 24, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  banner(text, sub) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(10, 16, 24, 0.75)';
    ctx.fillRect(0, 44, W, sub ? 62 : 44);
    ctx.fillStyle = ACCENT;
    ctx.font = '600 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, W / 2, 75);
    if (sub) {
      ctx.fillStyle = 'rgba(238, 243, 247, 0.8)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(sub, W / 2, 96);
    }
    ctx.textAlign = 'start';
  }
}
