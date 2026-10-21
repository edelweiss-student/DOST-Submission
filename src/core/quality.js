// Picks graphics settings for the GPU the browser actually gives us, then
// trims render resolution at runtime if the frame rate drops.

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

export function pickTier(gpu) {
  const forced = new URLSearchParams(location.search).get('quality');
  if (TIERS[forced]) return forced;
  if (/RTX|GTX 1[0-9]{3}|RX [5-9][0-9]{3}|RX [4-7][0-9]{2}\b|Radeon Pro|Arc A[57]|Apple M[0-9]+ (Pro|Max|Ultra)/i.test(gpu)) return 'high';
  if (/SwiftShader|llvmpipe|Basic Render|Mali|Adreno|PowerVR|HD Graphics [0-9]{3,4}\b/i.test(gpu)) return 'low';
  return 'medium';
}

// Short GPU name from strings like "ANGLE (Intel, Intel(R) Graphics (0x...) Direct3D11 ...)".
export function shortGPU(gpu) {
  const m = /ANGLE \([^,]*,\s*(.+?)(?:\s*\(0x[0-9A-Fa-f]+\))?\s*(?:Direct3D|OpenGL|Vulkan|Metal|,)/.exec(gpu);
  return (m ? m[1] : gpu).trim();
}

export class AdaptiveResolution {
  constructor(renderer, basePixelRatio, minScale) {
    this.renderer = renderer;
    this.base = basePixelRatio;
    this.min = minScale;
    this.scale = 1;
    this.elapsed = 0;
    this.frames = 0;
    this.cooldown = 3;
    this.fps = 0;
    this.ms = 0;
  }

  update(dt) {
    this.elapsed += dt;
    this.frames++;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.elapsed < 1) return;
    this.fps = this.frames / this.elapsed;
    this.ms = (this.elapsed / this.frames) * 1000;
    this.elapsed = 0;
    this.frames = 0;
    if (this.cooldown > 0) return;

    let next = this.scale;
    if (this.fps < 50 && this.scale > this.min) {
      next = Math.max(this.min, this.scale - 0.1);
      this.cooldown = 4;
    } else if (this.fps > 90 && this.scale < 1) {
      // Only climb back when there's clear headroom, to avoid flip-flopping.
      next = Math.min(1, this.scale + 0.05);
      this.cooldown = 8;
    }
    if (next !== this.scale) {
      this.scale = next;
      this.renderer.setPixelRatio(this.base * this.scale);
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

export function createPerfOverlay(el, { renderer, adaptive, gpuTimer, tier, gpu, water }) {
  let timer = 0;
  return {
    get visible() { return el.classList.contains('show'); },
    toggle() { el.classList.toggle('show'); },
    update(dt) {
      if (!el.classList.contains('show') || (timer -= dt) > 0) return;
      timer = 0.5;
      const info = renderer.info.render;
      const gpuMs = gpuTimer?.ext ? ` · GPU ${gpuTimer.ms.toFixed(1)} ms` : '';
      el.textContent =
        `${Math.round(adaptive.fps)} fps · ${adaptive.ms.toFixed(1)} ms${gpuMs}\n` +
        `Graphics ${TIERS[tier].label} · water ${water.quality} · render scale ${Math.round(adaptive.scale * 100)}%\n` +
        `${info.calls} draw calls · ${(info.triangles / 1000).toFixed(0)}k triangles\n` +
        `${shortGPU(gpu)}`;
    },
  };
}
