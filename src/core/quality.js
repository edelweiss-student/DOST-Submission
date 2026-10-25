// Picks graphics settings for the GPU the browser actually gives us (or
// the ones chosen in Settings > Graphics), then trims render resolution at
// runtime if the frame rate falls short.

// texSize: procedural ground texture resolution. shadowMap: sun shadow map
// size (0 = no shadows), covering shadowRange metres around the player,
// redrawn every shadowEvery frames. grass: radius and spacing of the 3D
// grass around the player (radius 0 = none). trees: full 3D trees within
// near metres, dithering over band metres into billboards, drawn out to far metres.
export const TIERS = {
  // Old or software GPUs.
  low: {
    label: 'Low', pixelRatio: 0.8, antialias: false, minScale: 0.6,
    texSize: 256, anisotropy: 2, shadowMap: 0, shadowRange: 0, shadowTaps: 1, shadowEvery: 1,
    grass: { radius: 0, spacing: 1 }, cloudShadows: false,
    trees: { near: 26, band: 4, far: 260 },
  },
  // Integrated graphics such as Intel Graphics / Iris Xe.
  medium: {
    label: 'Medium', pixelRatio: 1.25, antialias: true, minScale: 0.7,
    texSize: 512, anisotropy: 4, shadowMap: 1024, shadowRange: 38, shadowTaps: 1, shadowEvery: 2,
    grass: { radius: 16, spacing: 0.46 }, cloudShadows: true,
    trees: { near: 36, band: 5, far: 400 },
  },
  // Dedicated GPUs such as GeForce RTX.
  high: {
    label: 'High', pixelRatio: 1.5, antialias: true, minScale: 0.75,
    texSize: 1024, anisotropy: 8, shadowMap: 2048, shadowRange: 64, shadowTaps: 4, shadowEvery: 1,
    grass: { radius: 28, spacing: 0.36 }, cloudShadows: true,
    trees: { near: 95, band: 8, far: 1000 },
  },
};

export function detectGPU() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name);
  } catch {
    return 'unknown';
  }
}

// The tier that suits this GPU (what Auto picks).
export function autoTier(gpu) {
  if (/RTX|GTX 1[0-9]{3}|RX [5-9][0-9]{3}|RX [4-7][0-9]{2}\b|Radeon Pro|Arc A[57]|Apple M[0-9]+ (Pro|Max|Ultra)/i.test(gpu)) return 'high';
  if (/SwiftShader|llvmpipe|Basic Render|Mali|Adreno|PowerVR|HD Graphics [0-9]{3,4}\b/i.test(gpu)) return 'low';
  return 'medium';
}

// The tier to play at: ?quality= in the address, else the one chosen in
// the settings, else Auto's.
export function pickTier(gpu, preset) {
  const forced = new URLSearchParams(location.search).get('quality');
  if (TIERS[forced]) return forced;
  return TIERS[preset] ? preset : autoTier(gpu);
}

// Settings > Graphics, kept between visits. preset: 'auto' or a tier;
// antialias: 'auto' (the tier's), 'on' or 'off' (both apply when the game
// next loads); target: the frame rate the render resolution adapts to
// keep, 'screen' (the screen's refresh rate), 60, 120 or 'off' (always
// full resolution); readout: the performance readout (P) is up.
const GRAPHICS_KEY = 'washed-away.graphics';
const GRAPHICS = { preset: 'auto', antialias: 'auto', target: 'screen', readout: false };
export function loadGraphics() {
  try {
    return { ...GRAPHICS, ...JSON.parse(localStorage.getItem(GRAPHICS_KEY) ?? '{}') };
  } catch {
    return { ...GRAPHICS };   // storage blocked, or nothing sensible saved
  }
}
export function saveGraphics(settings) {
  try { localStorage.setItem(GRAPHICS_KEY, JSON.stringify(settings)); } catch { /* storage blocked */ }
}

// The screen's refresh rate (frames per second), from how often the
// browser offers to draw while nothing is being drawn: the typical gap of
// `frames`, leaving out any half again longer than the short ones, so a
// busy moment can't make it look slower, and called the usual rate it's
// within 3% of. Resolves to null if the page isn't drawing (a hidden tab)
// within `wait` ms.
const RATES = [60, 72, 75, 90, 100, 120, 144, 165, 175, 180, 240, 360];
export function measureRefresh(frames = 30, wait = 1500) {
  return new Promise((resolve) => {
    const times = [];
    const tick = (t) => {
      times.push(t);
      if (times.length <= frames) {
        requestAnimationFrame(tick);
        return;
      }
      const gaps = times.slice(1).map((time, i) => time - times[i]).sort((a, b) => a - b);
      const usual = gaps.filter((gap) => gap < gaps[Math.floor(gaps.length / 10)] * 1.5);
      const hz = 1000 / usual[Math.floor(usual.length / 2)];
      resolve(RATES.find((rate) => Math.abs(hz / rate - 1) < 0.03) ?? Math.round(hz));
    };
    requestAnimationFrame(tick);
    setTimeout(() => resolve(null), wait);
  });
}

// Short GPU name from strings like "ANGLE (Intel, Intel(R) Graphics (0x...) Direct3D11 ...)".
export function shortGPU(gpu) {
  const m = /ANGLE \([^,]*,\s*(.+?)(?:\s*\(0x[0-9A-Fa-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|Metal|,)/.exec(gpu);
  return (m ? m[1] : gpu).trim();
}

// Render resolution that keeps up a target frame rate: it steps down
// (towards minScale of full resolution) while frames come slower than the
// target, and back up while they keep pace with it. The target can't be
// more than the screen shows (refresh), which the browser caps drawing at.
// A step that fell short isn't tried again for half a minute, so it
// doesn't flip back and forth.
export class AdaptiveResolution {
  constructor(renderer, basePixelRatio, minScale) {
    this.renderer = renderer;
    this.base = basePixelRatio;
    this.min = minScale;
    this.scale = 1;
    this.target = 'screen';   // see loadGraphics()
    this.refresh = 60;        // the screen's refresh rate, once measured
    this.elapsed = 0;
    this.frames = 0;
    this.cooldown = 3;
    this.tooSlow = Infinity;  // a scale that fell short lately, and for how much longer
    this.tooSlowFor = 0;
    this.fps = 0;
    this.ms = 0;
  }

  // Frames per second it aims for (0: none, full resolution).
  get goal() {
    if (this.target === 'off') return 0;
    return this.target === 'screen' ? this.refresh : Math.min(Number(this.target), this.refresh);
  }

  setTarget(target) {
    this.target = target;
    this.cooldown = 1;
    this.tooSlow = Infinity;
    if (!this.goal) this.setScale(1);
  }

  setScale(scale) {
    if (scale === this.scale) return;
    this.scale = scale;
    this.renderer.setPixelRatio(this.base * scale);
  }

  update(dt) {
    this.elapsed += dt;
    this.frames++;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if ((this.tooSlowFor -= dt) <= 0) this.tooSlow = Infinity;
    if (this.elapsed < 1) return;
    this.fps = this.frames / this.elapsed;
    this.ms = (this.elapsed / this.frames) * 1000;
    this.elapsed = 0;
    this.frames = 0;
    // Faster than we thought the screen was (the window went to another one).
    if (this.fps > this.refresh * 1.08) this.refresh = Math.round(this.fps);
    const goal = this.goal;
    if (!goal || this.cooldown > 0) return;

    if (this.fps < goal * 0.9 && this.scale > this.min) {
      // Bigger steps the further short it falls.
      const step = this.fps < goal * 0.7 ? 0.1 : 0.05;
      this.tooSlow = this.scale;
      this.tooSlowFor = 30;
      this.setScale(Math.max(this.min, Math.round((this.scale - step) * 100) / 100));
      this.cooldown = 2;
    } else if (this.fps > goal * 0.96 && this.scale < 1) {
      const next = Math.min(1, Math.round((this.scale + 0.05) * 100) / 100);
      if (next < this.tooSlow) {
        this.setScale(next);
        this.cooldown = 4;
      }
    }
  }
}

// GPU time per frame, from timer queries where the browser offers them.
// Only runs while the performance readout is open.
export class GpuTimer {
  constructor(renderer) {
    this.gl = renderer.getContext();
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.pending = [];
    this.active = null;
    this.ms = 0;
    this.samples = [];
  }

  begin(enabled) {
    if (!this.ext || !enabled || this.pending.length > 4) return;
    this.active = this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active);
  }

  end() {
    const { gl, ext } = this;
    if (this.active) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.pending.push(this.active);
      this.active = null;
    }
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        this.samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        if (this.samples.length > 60) this.samples.shift();
        this.ms = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
      }
      gl.deleteQuery(q);
    }
  }
}

export function createPerfOverlay(el, { renderer, adaptive, gpuTimer, tier, gpu, water, antialias }) {
  let timer = 0;
  return {
    get visible() { return el.classList.contains('show'); },
    show(on) { el.classList.toggle('show', on); },
    update(dt) {
      if (!el.classList.contains('show') || (timer -= dt) > 0) return;
      timer = 0.5;
      const info = renderer.info.render;
      const gpuMs = gpuTimer?.ext ? ` · GPU ${gpuTimer.ms.toFixed(1)} ms` : '';
      const goal = adaptive.goal ? `aiming for ${adaptive.goal} fps` : 'full resolution';
      el.textContent =
        `${Math.round(adaptive.fps)} fps · ${adaptive.ms.toFixed(1)} ms${gpuMs} · screen ${adaptive.refresh} Hz\n` +
        `Graphics ${TIERS[tier].label} · anti-aliasing ${antialias ? 'on' : 'off'} · water ${water.quality}\n` +
        `Render scale ${Math.round(adaptive.scale * 100)}% (${goal})\n` +
        `${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k triangles\n` +
        `${shortGPU(gpu)}`;
    },
  };
}
