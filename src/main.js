import * as THREE from 'three';
import './style.css';
import { mulberry32, uniforms } from './shared.js';
import { TIERS, detectGPU, pickTier, shortGPU, AdaptiveResolution, GpuTimer, createPerfOverlay } from './core/quality.js';
import { TextureBaker, bakeGround, bakeBark, bakeCloudNoise } from './world/textures.js';
import { installShadowFilter } from './world/materials.js';
import { createTerrain } from './world/terrain.js';
import { createVegetation } from './world/vegetation.js';
import { createGrass } from './world/grass.js';
import { createOcean } from './world/ocean.js';
import { createWater } from './world/water.js';
import { createSplashes } from './world/splash.js';
import { createSky } from './world/sky.js';
import { Weather, WEATHER_KEYS } from './weather/weather.js';
import { createPrecipitation } from './weather/precipitation.js';
import { Player } from './player/player.js';
import { HUD } from './ui/hud.js';
import { Ambience } from './audio/ambience.js';

const seed = Number(new URLSearchParams(location.search).get('seed')) || 1337;
const rng = mulberry32(seed);

// Graphics settings for the GPU the browser actually hands us.
const gpu = detectGPU();
const tier = pickTier(gpu);
const quality = TIERS[tier];
const basePixelRatio = Math.min(devicePixelRatio, quality.pixelRatio);

const renderer = new THREE.WebGLRenderer({ antialias: quality.antialias, powerPreference: 'high-performance' });
renderer.setPixelRatio(basePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.shadowMap.enabled = quality.shadowMap > 0;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
installShadowFilter(quality.shadowTaps);
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const fog = new THREE.FogExp2('#b4dcf2', 0.0026);
scene.fog = fog;
scene.background = fog.color;
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2000);

// Procedural textures, drawn on the GPU once at startup.
const baker = new TextureBaker(renderer);
const ground = bakeGround(baker, quality.texSize, quality.anisotropy);
const bark = bakeBark(baker, quality.texSize, quality.anisotropy);
const cloudTexture = bakeCloudNoise(baker);
uniforms.uCloudTex.value = cloudTexture;
const cloudShadows = quality.cloudShadows;

const terrain = createTerrain(rng, { ground, cloudShadows, castShadow: tier === 'high' });
scene.add(terrain.mesh);
const vegetation = createVegetation(scene, terrain, rng, renderer, { quality, ground, bark, cloudShadows });
const grass = createGrass(scene, terrain, { ...quality.grass, anisotropy: quality.anisotropy, msaa: quality.antialias, cloudShadows });
const ocean = createOcean(scene, terrain, rng, { ground, anisotropy: quality.anisotropy, cloudShadows });
// Water quality is its own setting (on the pause screen), remembered between visits.
const WATER_KEY = 'borrowed-time.water-quality';
let savedWater = null;
try { savedWater = localStorage.getItem(WATER_KEY); } catch { /* storage blocked */ }
const water = createWater(scene, terrain, renderer, savedWater || (tier === 'low' ? 'medium' : 'high'));
const splashes = createSplashes(scene);
const sky = createSky(scene, renderer, {
  cloudTexture, shadowMap: quality.shadowMap, shadowRange: quality.shadowRange, cloudShadows,
});
const weather = new Weather(rng);
const precip = createPrecipitation(scene, terrain, rng);
const player = new Player(camera, renderer.domElement, terrain, vegetation.colliders, water);
const hud = new HUD();
const audio = new Ambience();
const adaptive = new AdaptiveResolution(renderer, basePixelRatio, quality.minScale);
const gpuTimer = new GpuTimer(renderer);
const perf = createPerfOverlay(document.getElementById('perf'), { renderer, adaptive, gpuTimer, tier, gpu, water });

const MILESTONES = [
  'Solar output is climbing. The weather is getting harder to predict.',
  'The sea is rising. The beaches won’t last.',
  'Storms and heatwaves are coming faster now.',
  'The climate has broken. Hold on.',
];
weather.onChange = () => hud.message(`Weather shifting: ${weather.label}`);
weather.onMilestone = (m) => hud.message(MILESTONES[m - 1], 7);
precip.onStrike = (distance) => audio.thunder(distance);
player.onMessage = (text) => hud.message(text, 5);
player.onSplash = (x, y, z, speed) => {
  splashes.emit(x, y, z, speed);
  audio.splash(speed);
};

// On integrated graphics, point out the dedicated GPU setting.
if (tier !== 'high' && /Intel|AMD Radeon\(TM\) Graphics|AMD Radeon Graphics/i.test(gpu)) {
  document.getElementById('gpu-tip').textContent =
    `Running on ${shortGPU(gpu)}. If this PC also has an NVIDIA or AMD graphics card, set your browser to ` +
    '"High performance" in Windows Settings > System > Display > Graphics for smoother play.';
}

// Start / pause overlay. Pointer lock is preferred; where the browser
// refuses it (e.g. embedded previews) we fall back to drag-to-look.
const overlay = document.getElementById('overlay');
const playLabel = overlay.querySelector('.play');
let ready = false;
let started = false;
const isPlaying = () => player.controls.isLocked || player.dragLook;
player.enableDragLook(renderer.domElement);

function onPlay() {
  overlay.classList.add('hidden');
  if (!started) {
    started = true;
    hud.message('Day 1. The sun is swelling. Explore the island and the reef while you can.', 6);
  }
}
function startDragLook() {
  if (player.dragLook) return;
  player.dragLook = true;
  onPlay();
  hud.message('Mouse capture is blocked here. Hold the left button and drag to look. Esc pauses.', 7);
}
overlay.addEventListener('click', () => {
  if (!ready) return;
  audio.start();
  try {
    const request = renderer.domElement.requestPointerLock();
    request?.catch?.(startDragLook);
  } catch {
    startDragLook();
  }
});
document.addEventListener('pointerlockerror', startDragLook);
player.controls.addEventListener('lock', onPlay);
player.controls.addEventListener('unlock', () => overlay.classList.remove('hidden'));

const waterButtons = document.querySelectorAll('[data-water]');
const markWater = () => waterButtons.forEach((b) => b.classList.toggle('active', b.dataset.water === water.quality));
waterButtons.forEach((button) => button.addEventListener('click', (e) => {
  e.stopPropagation(); // don't start the game
  water.setQuality(button.dataset.water);
  try { localStorage.setItem(WATER_KEY, water.quality); } catch { /* storage blocked */ }
  markWater();
}));
markWater();

// P toggles the performance readout. Dev keys: 1-7 force weather,
// T skips an hour, K fast-forwards the climate, G sends a rogue wave set, M mutes.
addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') perf.toggle();
  if (e.code === 'Escape' && player.dragLook) {
    player.dragLook = false;
    overlay.classList.remove('hidden');
  }
  if (!isPlaying()) return;
  if (e.code.startsWith('Digit')) {
    const key = WEATHER_KEYS[Number(e.code.slice(5)) - 1];
    if (key) weather.force(key);
  } else if (e.code === 'KeyT') {
    sky.skip(1);
  } else if (e.code === 'KeyK') {
    weather.advanceClimate(150);
    hud.message(`Climate fast-forwarded: instability ${Math.round(Math.min(1, weather.elapsed / 1500) * 100)}%`, 3);
  } else if (e.code === 'KeyM') {
    hud.message(audio.toggleMute() ? 'Sound off' : 'Sound on', 2);
  } else if (e.code === 'KeyG') {
    water.waves.spawnRogue(camera.position);
    hud.message('A rogue wave set is rolling in from upwind.', 4);
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const underwaterColor = new THREE.Color('#1f6878');
const clock = new THREE.Clock();
let t = 0;
let shadowFrame = 0;

function frame() {
  step();
  requestAnimationFrame(frame);
}

function step() {
  const dt = Math.min(clock.getDelta(), 0.05);
  // While paused, waves and particles keep moving but the simulation stops.
  const sdt = isPlaying() ? dt : 0;
  t += dt;
  uniforms.uTime.value = t;

  weather.update(sdt);
  player.update(sdt, t);
  uniforms.uPlayerPos.value.copy(player.pos);
  precip.update(sdt, t, camera, weather);
  const env = sky.update(sdt, camera, weather.current, precip.flash, weather.instability);
  weather.dayF = env.dayF;
  water.update(camera, weather, env, precip.flash, sdt);
  ocean.update(t, camera, weather.seaLevel);
  vegetation.update(camera);
  grass.update(camera);
  splashes.update(dt, env.dayF);

  sky.dome.visible = !player.underwater;
  let exposure = env.exposure;
  if (player.underwater) {
    fog.color.copy(underwaterColor).multiplyScalar((0.2 + 0.8 * env.dayF) * Math.max(0.3, 1 - player.depth / 40) * 0.6);
    uniforms.uFogSunColor.value.copy(fog.color).multiplyScalar(1.6);
    fog.density = 0.032;
    exposure *= 1.25;
  } else {
    fog.color.copy(env.fogColor);
    fog.density = weather.current.fog;
  }
  uniforms.uFogColor.value.copy(fog.color);
  renderer.toneMappingExposure = exposure;
  // Redraw sun shadows only while there is a sun (or moon) to cast them,
  // and on slower GPUs every other frame (the map stays valid in between).
  shadowFrame = (shadowFrame + 1) % quality.shadowEvery;
  renderer.shadowMap.needsUpdate = sky.sun.intensity > 0.02 && shadowFrame === 0;

  audio.update(weather, player.underwater, water.waves.hs);
  hud.update(dt, { weather, clock: sky.clock(), player, waves: water.waves });
  gpuTimer.begin(perf.visible);
  renderer.render(scene, camera);
  gpuTimer.end();
  adaptive.update(dt);
  perf.update(dt);
}

// Compile every shader before the first frame (in parallel where the
// browser allows), so nothing stalls when new things come into view.
playLabel.textContent = 'Loading…';
sky.update(0, camera, weather.current, 0, 0);
renderer.compileAsync(scene, camera).catch(() => {}).finally(() => {
  ready = true;
  playLabel.textContent = 'Click to play';
  requestAnimationFrame(frame);
});

if (import.meta.env.DEV) {
  window.game = {
    scene, camera, renderer, terrain, weather, player, sky, water, uniforms, vegetation, step,
    counts: vegetation.counts, quality: { tier, gpu, adaptive, gpuTimer },
  };
}
