import { mulberry32 } from '../shared.js';

// Music in the spirit of the kulintang, the gong music of Mindanao, made
// up as it plays (the game ships no audio files): a row of eight small
// gongs (the kulintang itself) plays the melody over the deep agung gongs,
// the babendil keeps time on a gong's rim and, once things get tense, the
// dabakan drum joins in. intensity (0..1: the climate's pressure and the
// wind, so a match's storm builds it) quickens the tempo and fills in the
// pattern. It plays through the ambience's master, so M mutes it too and it
// sounds muffled underwater.

// The kulintang's gongs: a pentatonic row, low to high (Hz).
const ROW = [293.7, 329.6, 370, 440, 493.9, 587.3, 659.3, 740];
const AGUNG = [73.4, 110];          // the deep gongs, D and A
const LOOKAHEAD = 0.3;              // seconds of notes scheduled ahead
const KEY = 'washed-away.music';

export class Music {
  constructor(ambience) {
    this.ambience = ambience;
    this.rng = mulberry32(2026);
    this.intensity = 0;
    this.on = true;
    try { this.on = localStorage.getItem(KEY) !== 'off'; } catch { /* storage blocked */ }
    this.out = null;
    this.next = 0;      // when the next eighth note falls (AudioContext time)
    this.step = 0;      // eighth notes since the start
    this.motif = [];
  }

  // Starts with the ambience (it needs a click first, like all browser audio).
  start() {
    const ctx = this.ambience.ctx;
    if (!ctx || this.out) return;
    this.out = ctx.createGain();
    this.out.gain.value = this.on ? 0.16 : 0;
    // A little room around the gongs: a short convolution reverb.
    const reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 1.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    this.out.connect(this.ambience.master);
    this.out.connect(reverb).connect(wet).connect(this.ambience.master);
    this.next = ctx.currentTime + 0.5;
    this.newMotif();
    this.timer = setInterval(() => this.schedule(), 100);
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem(KEY, this.on ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (this.out) this.out.gain.setTargetAtTime(this.on ? 0.16 : 0, this.ambience.ctx.currentTime, 0.3);
    return this.on;
  }

  // A new two-bar phrase for the kulintang: a walk over the row, with rests,
  // that leans higher and busier as the intensity climbs.
  newMotif() {
    const r = this.rng, busy = 0.45 + 0.4 * this.intensity;
    let note = 2 + Math.floor(r() * 3);
    this.motif = Array.from({ length: 16 }, (_, i) => {
      if (i % 4 !== 0 && r() > busy) return -1;
      // A step or two either way, drawn back towards the middle of the row.
      note = Math.max(0, Math.min(ROW.length - 1, note + Math.round((r() - 0.5) * 3.2 + (3.5 - note) * 0.3)));
      return note;
    });
  }

  // Schedules everything due in the next LOOKAHEAD seconds.
  schedule() {
    const ctx = this.ambience.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.05;
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this.play(this.step, this.next);
      const bpm = 84 + 40 * this.intensity;
      this.next += 30 / bpm;   // an eighth note
      this.step++;
      if (this.step % 32 === 0) this.newMotif();   // a new phrase every four bars
    }
  }

  play(step, t) {
    const i = this.intensity, beat = step % 8;
    const note = this.motif[step % 16];
    // Every other pass the melody climbs an octave's worth of the row.
    if (note >= 0) this.gong(t, ROW[Math.min(ROW.length - 1, note + (step % 32 >= 16 && i > 0.5 ? 2 : 0))], 0.32, 1.1);
    if (beat === 0) this.agung(t, AGUNG[0], 0.5);
    if (beat === 4 && i > 0.45) this.agung(t, AGUNG[1], 0.32);
    if (step % 2 === 0) this.babendil(t, beat === 0 ? 0.09 : 0.05);
    if (i > 0.3 && (beat === 3 || beat === 6 || (i > 0.7 && beat === 7))) this.dabakan(t, 0.25 + 0.3 * i);
  }

  // A small gong: a clear fundamental and two faint, out-of-tune partials,
  // struck and ringing away.
  gong(t, freq, peak, decay) {
    this.tone(t, [[1, 1], [2.76, 0.16], [5.4, 0.05]], freq, peak, 0.006, decay);
  }

  // A deep gong: slow to speak, sagging a little in pitch, ringing long.
  agung(t, freq, peak) {
    this.tone(t, [[1, 1], [2.02, 0.35], [3.01, 0.12]], freq, peak, 0.03, 3.2, 1.025);
  }

  // The time-keeper: a dry, bright tap on a gong's rim.
  babendil(t, peak) {
    this.tone(t, [[1, 1], [1.47, 0.6], [2.31, 0.3]], 1580, peak, 0.002, 0.14);
  }

  // The goblet drum: a thump that drops in pitch.
  dabakan(t, peak) {
    const ctx = this.ambience.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.3);
  }

  // partials: [[ratio, level]]; bend: starting pitch over the settled one.
  tone(t, partials, freq, peak, attack, decay, bend = 1) {
    const ctx = this.ambience.ctx, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(this.out);
    for (const [ratio, level] of partials) {
      const o = ctx.createOscillator(), a = ctx.createGain();
      o.frequency.setValueAtTime(freq * ratio * bend, t);
      if (bend !== 1) o.frequency.exponentialRampToValueAtTime(freq * ratio, t + 0.25);
      a.gain.value = level;
      o.connect(a).connect(g);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }
}
