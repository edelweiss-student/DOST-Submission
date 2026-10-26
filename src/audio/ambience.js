// Procedural ambience: wind, rain, surf, underwater rumble and thunder,
// all synthesized from noise so the game ships no audio files.
export class Ambience {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.background = 1;   // how loud the wind, rain and surf are (the trailer turns them down)
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext());

    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = this.white.getChannelData(0), bd = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      wd[i] = w;
      last = (last + 0.02 * w) / 1.02;
      bd[i] = last * 3.5;
    }

    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.master.connect(this.muffle).connect(ctx.destination);

    const chain = (buffer, ...nodes) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = Math.random();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let n = src;
      for (const node of nodes) n = n.connect(node);
      n.connect(gain).connect(this.master);
      src.start(0, Math.random() * 2);
      return gain;
    };
    const filter = (type, freq, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      return f;
    };
    const lfo = (rate, depth, param) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = rate; g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
    };

    const windBand = filter('bandpass', 500, 0.8);
    lfo(0.13, 260, windBand.frequency);
    this.wind = chain(this.brown, windBand);
    this.rain = chain(this.white, filter('highpass', 1500), filter('lowpass', 7000));
    this.surf = chain(this.brown, filter('lowpass', 420));
    this.rumble = chain(this.brown, filter('lowpass', 150));
  }

  update(weather, underwater, seaHs) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, c = weather.current, b = this.background;
    const set = (param, v) => param.setTargetAtTime(v, t, 0.4);
    set(this.wind.gain, (0.05 + c.wind * c.wind * 0.6) * (underwater ? 0.25 : 1) * b);
    set(this.rain.gain, c.rain * 0.3 * (underwater ? 0.15 : 1) * b);
    set(this.surf.gain, (0.05 + Math.min(seaHs, 4) * 0.05) * b);
    set(this.rumble.gain, underwater ? 0.55 : 0);
    set(this.muffle.frequency, underwater ? 520 : 18000);
    set(this.master.gain, this.muted ? 0 : 0.7);
  }

  thunder(distance) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + distance / 343;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260 - Math.min(distance, 400) * 0.3;
    const g = ctx.createGain();
    const peak = 1.4 * (1 - Math.min(distance, 450) / 600);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.06);
    g.gain.exponentialRampToValueAtTime(peak * 0.5, start + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 4.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(start, Math.random());
    src.stop(start + 4.6);
  }

  splash(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.6;
    band.frequency.setValueAtTime(1100, t);
    band.frequency.exponentialRampToValueAtTime(320, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.min(0.9, 0.2 + strength * 0.08), t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(band).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.75);
  }

  // Something thrown (a spear) rushing past: noise swept up and back down.
  whoosh(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = Math.max(0.05, strength);
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(500, t);
    band.frequency.exponentialRampToValueAtTime(2200, t + 0.12);
    band.frequency.exponentialRampToValueAtTime(700, t + 0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8 * s, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(band).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.5);
  }

  // A footstep (or, swimming, a stroke) on `surface`: 'sand', 'grass',
  // 'wood' (something built), 'water' (wading) or 'swim'; strength 0..1,
  // how fast you're going. Each one a little different.
  step(surface, strength = 0.5) {
    if (!this.ctx) return;
    const s = 0.5 + 0.5 * strength, j = 0.85 + Math.random() * 0.3;
    switch (surface) {
      case 'sand':
        this.burst(this.white, 'bandpass', 700 * j, 0.8, 0.12 * s, 0.11);
        this.burst(this.brown, 'lowpass', 200, 0.7, 0.18 * s, 0.08);
        break;
      case 'grass':
        this.burst(this.white, 'bandpass', 3200 * j, 0.7, 0.08 * s, 0.13);
        this.burst(this.brown, 'lowpass', 180, 0.7, 0.14 * s, 0.07);
        break;
      case 'wood':
        this.burst(this.white, 'bandpass', 520 * j, 3, 0.22 * s, 0.07);
        this.burst(this.brown, 'lowpass', 160, 0.7, 0.3 * s, 0.1);
        break;
      case 'water':
        this.burst(this.white, 'bandpass', 1400 * j, 0.6, 0.16 * s, 0.22);
        break;
      case 'swim':
        this.burst(this.white, 'bandpass', 900 * j, 0.6, 0.12 * s, 0.35);
        break;
    }
  }

  // In a match: hurt (a thump and a grunt, strength 0..1 by how hard), a
  // blow of yours landing on a player (hit) or a bed (hit('bed')), and a
  // horn when any team's bed is broken or washed away.
  hurt(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, s = Math.min(1, Math.max(0.3, strength));
    this.burst(this.brown, 'lowpass', 140, 0.7, 0.9 * s, 0.25);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * s, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
  }

  hit(target = 'player') {
    if (!this.ctx) return;
    if (target === 'bed') {
      this.burst(this.brown, 'lowpass', 300, 0.7, 0.6, 0.18);
      this.burst(this.white, 'bandpass', 900, 1, 0.25, 0.15);
    } else {
      this.burst(this.white, 'bandpass', 2000, 1.5, 0.5, 0.06);
      this.burst(this.brown, 'lowpass', 250, 0.7, 0.6, 0.12);
    }
  }

  horn() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.08);
    g.gain.setValueAtTime(0.22, t + 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    low.connect(g).connect(this.master);
    for (const f of [110, 110.7, 165]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(low);
      o.start(t);
      o.stop(t + 2.2);
    }
  }

  // A trunk groaning as it leans: a low buzz through a narrow band.
  groan(strength, length) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(55, t + length);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * strength, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(band).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + length + 0.05);
  }

  // A short filtered noise burst: the building block of the wood sounds.
  burst(buffer, type, freq, q, peak, decay, delay = 0) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + decay + 0.05);
  }

  // Wood: an axe biting (chop), a log splitting (split), a tree cracking
  // and groaning as it goes over (crack) and crashing down, leaves and all
  // (thud), its crown
  // breaking up (break), logs and planks knocking down (log, plank), and a
  // plank going into a build (knock). strength 0..1.
  wood(kind, strength = 1) {
    if (!this.ctx) return;
    const s = Math.max(0.05, strength);
    switch (kind) {
      case 'chop':
        this.burst(this.white, 'bandpass', 1500, 1.4, 0.7 * s, 0.09);
        this.burst(this.brown, 'lowpass', 320, 0.7, 0.9 * s, 0.16);
        break;
      case 'split':
        this.burst(this.white, 'bandpass', 2600, 0.9, 0.6 * s, 0.25);
        this.burst(this.brown, 'lowpass', 260, 0.7, 0.8 * s, 0.3, 0.02);
        break;
      case 'crack':
        this.burst(this.white, 'bandpass', 2200, 0.8, 0.8 * s, 0.35);
        this.burst(this.white, 'bandpass', 1200, 2, 0.5 * s, 0.6, 0.25);
        // Fibres snapping one after another.
        for (let i = 0; i < 6; i++) this.burst(this.white, 'bandpass', 1600 + Math.random() * 1400, 3, 0.35 * s, 0.05, 0.15 + i * 0.16 + Math.random() * 0.08);
        this.groan(s, 1.6);
        break;
      case 'thud':
        this.burst(this.brown, 'lowpass', 110, 0.7, 1.6 * s, 1.3);
        this.burst(this.brown, 'lowpass', 420, 0.7, 0.9 * s, 0.5);   // the body small speakers can play
        this.burst(this.white, 'bandpass', 2500, 0.6, 0.3 * s, 0.8, 0.05);
        this.burst(this.white, 'bandpass', 4500, 0.5, 0.45 * s, 1.1, 0.03);   // the crown crashing through leaves
        break;
      case 'break':
        this.burst(this.white, 'bandpass', 3200, 0.5, 0.2 * s, 0.6);
        break;
      case 'log':
        this.burst(this.brown, 'lowpass', 220, 0.7, 0.8 * s, 0.3);
        break;
      case 'plank':
        this.burst(this.white, 'bandpass', 900, 2, 0.5 * s, 0.08);
        break;
      case 'knock':
        this.burst(this.white, 'bandpass', 700, 2.5, 0.6 * s, 0.07);
        this.burst(this.brown, 'lowpass', 240, 0.7, 0.6 * s, 0.12);
        break;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}
