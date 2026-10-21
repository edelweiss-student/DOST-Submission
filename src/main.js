import * as THREE from 'three';
import './style.css';
import { mulberry32, uniforms } from './shared.js';
import { TIERS, detectGPU, pickTier, shortGPU, AdaptiveResolution, GpuTimer, createPerfOverlay } from './core/quality.js';
import { TextureBaker, bakeGround, bakeCloudNoise } from './world/textures.js';
import { installShadowFilter } from './world/materials.js';
import { createTerrain } from './world/terrain.js';
import { createVegetation } from './world/vegetation.js';
import { loadTreeModels } from './world/trees.js';
import { createGrass } from './world/grass.js';
import { createOcean } from './world/ocean.js';
import { createWater } from './world/water.js';
import { createSplashes } from './world/splash.js';
import { createSky } from './world/sky.js';
import { Weather, WEATHER_KEYS } from './weather/weather.js';
import { SeaLevel } from './weather/sealevel.js';
import { createPrecipitation } from './weather/precipitation.js';
import { Player } from './player/player.js';
import { HUD } from './ui/hud.js';
import { Ambience } from './audio/ambience.js';
import { ITEMS } from './items/items.js';
import { Inventory } from './items/inventory.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { createGathering } from './world/gathering.js';

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

// The tree models are the game's only asset files. Start loading them now,
// so they download and decode while the island is generated.
document.querySelector('#overlay .play').textContent = 'Loading…';
const treeModelsLoading = loadTreeModels(quality.anisotropy);

// Procedural textures, drawn on the GPU once at startup.
const baker = new TextureBaker(renderer);
const ground = bakeGround(baker, quality.texSize, quality.anisotropy);
const cloudTexture = bakeCloudNoise(baker);
uniforms.uCloudTex.value = cloudTexture;
const cloudShadows = quality.cloudShadows;

const terrain = createTerrain(rng, { ground, cloudShadows, castShadow: tier === 'high' });
scene.add(terrain.mesh);
const treeModels = await treeModelsLoading;
const vegetation = createVegetation(scene, terrain, rng, { quality, ground, cloudShadows, treeModels });
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
const sea = new SeaLevel(water);
const precip = createPrecipitation(scene, terrain, rng);
const player = new Player(camera, renderer.domElement, terrain, vegetation.colliders, water);
const hud = new HUD();
const audio = new Ambience();
const adaptive = new AdaptiveResolution(renderer, basePixelRatio, quality.minScale);
const gpuTimer = new GpuTimer(renderer);
const perf = createPerfOverlay(document.getElementById('perf'), { renderer, adaptive, gpuTimer, tier, gpu, water });

// Items: the bag with its hotbar and screen, and gathering from the world.
// Gathering has its own random numbers, so it doesn't change the weather's.
const inventory = new Inventory();
const gathering = createGathering(scene, { terrain, water, vegetation, inventory, rng: mulberry32(seed + 1) });
const throwDir = new THREE.Vector3();
function throwStack(stack) {
  camera.getWorldDirection(throwDir);
  const from = camera.position.clone().addScaledVector(throwDir, 0.6);
  from.y -= 0.3;
  const velocity = throwDir.clone().multiplyScalar(3.2).add(player.vel);
  velocity.y += 1.4;
  gathering.drop(stack, from, velocity);
}
const inventoryUI = new InventoryUI(inventory, { onDrop: throwStack });

const MILESTONES = [
  'Solar output is climbing. The weather is getting harder to predict.',
  'The sea is rising. The beaches won’t last.',
  'Storms and heatwaves are coming faster now.',
  'The climate has broken. Hold on.',
];
weather.onChange = () => hud.message(`Weather shifting: ${weather.label}`);
weather.onMilestone = (m) => hud.message(MILESTONES[m - 1], 7);
precip.onStrike = (distance) => audio.thunder(distance);
sea.onSurge = () => hud.message('Storm surge! The sea is pushing inland.', 5);
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
// The inventory frees the mouse but doesn't pause: the world keeps going.
const isPlaying = () => player.controls.isLocked || player.dragLook || inventoryUI.open;
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
// Opening the inventory gives the mouse back; closing it takes it again
// (or, if the browser refuses, pauses instead).
let leavingForInventory = false;
let relocking = false;
function openInventory() {
  player.setInput(false);
  inventoryUI.show();
  if (player.controls.isLocked) {
    leavingForInventory = true;
    document.exitPointerLock();
  }
}
function pauseInstead() {
  if (!relocking) return;
  relocking = false;
  overlay.classList.remove('hidden');
}
function closeInventory({ resume = true } = {}) {
  inventoryUI.hide();
  player.setInput(true);
  if (!resume) {
    overlay.classList.remove('hidden');
  } else if (!player.dragLook) {
    relocking = true;
    try {
      renderer.domElement.requestPointerLock()?.catch?.(pauseInstead);
    } catch {
      pauseInstead();
    }
  }
}
document.addEventListener('pointerlockerror', () => (relocking ? pauseInstead() : startDragLook()));
player.controls.addEventListener('lock', () => {
  relocking = false;
  onPlay();
});
player.controls.addEventListener('unlock', () => {
  if (leavingForInventory) leavingForInventory = false;
  else overlay.classList.remove('hidden');
});

const waterButtons = document.querySelectorAll('[data-water]');
const markWater = () => waterButtons.forEach((b) => b.classList.toggle('active', b.dataset.water === water.quality));
waterButtons.forEach((button) => button.addEventListener('click', (e) => {
  e.stopPropagation(); // don't start the game
  water.setQuality(button.dataset.water);
  try { localStorage.setItem(WATER_KEY, water.quality); } catch { /* storage blocked */ }
  markWater();
}));
markWater();

// E: gather from what you're looking at, or pick up an item.
let lastGather = 0;
function gather() {
  if (performance.now() - lastGather < 300) return;
  lastGather = performance.now();
  const result = gathering.interact(weather.elapsed);
  if (!result) return;
  for (const { id, count } of result.got) inventoryUI.notify(`+${count} ${ITEMS[id].name}`);
  if (result.empty) hud.message('Nothing left to gather here. It grows back with time.', 3);
  else if (result.full) hud.message('Your bag is full.', 3);
}

// Right-click: eat the selected item, if it's food.
function useSelected() {
  const stack = inventory.current;
  const food = stack && ITEMS[stack.id].eat;
  if (!food) return;
  inventory.take(inventory.selected, 1);
  player.eat(food);
  inventoryUI.notify(`Ate ${ITEMS[stack.id].name.toLowerCase()}`);
}

// Keys: 1-9 or the mouse wheel pick a hotbar slot, I or Tab open the
// inventory, E gathers, Q drops one of the selected item, P toggles the
// performance readout, M mutes. Dev keys: ` then 1-7 forces a weather type,
// T skips an hour, K fast-forwards the climate, G sends a rogue wave set.
let devArmed = -Infinity;
addEventListener('keydown', (e) => {
  if (e.code === 'KeyP') perf.toggle();
  if (e.code === 'Tab') e.preventDefault();
  if (e.code === 'Escape') {
    if (inventoryUI.open) {
      closeInventory({ resume: false });
      return;
    }
    if (player.dragLook) {
      player.dragLook = false;
      overlay.classList.remove('hidden');
    }
  }
  if (!isPlaying()) return;
  if (e.code === 'KeyI' || e.code === 'Tab') {
    if (inventoryUI.open) closeInventory();
    else openInventory();
    return;
  }
  const digit = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0;
  if (e.code === 'Backquote') {
    devArmed = performance.now();
    return;
  }
  if (digit && performance.now() - devArmed < 1500) {
    devArmed = -Infinity;
    const key = WEATHER_KEYS[digit - 1];
    if (key) weather.force(key);
    return;
  }
  if (inventoryUI.open) {
    // Over a slot, a number swaps it with that hotbar slot.
    if (digit >= 1 && inventoryUI.hover >= 0) inventory.swap(inventoryUI.hover, digit - 1);
    return;
  }
  if (digit >= 1) {
    inventory.select(digit - 1);
  } else if (e.code === 'KeyE') {
    gather();
  } else if (e.code === 'KeyQ') {
    const stack = inventory.take(inventory.selected, 1);
    if (stack) throwStack(stack);
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

addEventListener('wheel', (e) => {
  if (isPlaying() && !inventoryUI.open && e.deltaY) inventory.select(inventory.selected + Math.sign(e.deltaY));
}, { passive: true });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 2 && isPlaying() && !inventoryUI.open) useSelected();
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
  sea.update(sdt, weather, sky.state.time);
  player.update(sdt, t, weather.heatIndex);
  uniforms.uPlayerPos.value.copy(player.pos);
  const prompt = gathering.update(sdt, t, weather.elapsed, player, camera, isPlaying() && !inventoryUI.open);
  inventoryUI.setPrompt(inventoryUI.open ? null : prompt?.text ?? null, prompt?.dim);
  inventoryUI.update(dt);
  precip.update(sdt, t, camera, weather);
  const env = sky.update(sdt, camera, weather.current, precip.flash, weather.instability);
  weather.dayF = env.dayF;
  water.update(camera, weather, env, precip.flash, sdt);
  ocean.update(t, camera, sea.level);
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
  hud.update(dt, { weather, sea, clock: sky.clock(), player, waves: water.waves });
  gpuTimer.begin(perf.visible);
  renderer.render(scene, camera);
  gpuTimer.end();
  adaptive.update(dt);
  perf.update(dt);
}

// Compile every shader before the first frame (in parallel where the
// browser allows), so nothing stalls when new things come into view.
playLabel.textContent = 'Loading…';
sea.update(0, weather, sky.state.time);
sky.update(0, camera, weather.current, 0, 0);
renderer.compileAsync(scene, camera).catch(() => {}).finally(() => {
  ready = true;
  playLabel.textContent = 'Click to play';
  requestAnimationFrame(frame);
});

if (import.meta.env.DEV) {
  window.game = {
    scene, camera, renderer, terrain, weather, sea, player, sky, water, uniforms, vegetation, step, inventory, gathering,
    counts: vegetation.counts, quality: { tier, gpu, adaptive, gpuTimer },
  };
}
