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
import { ClimateEntity } from './climate/entity.js';
import { SeaLevel, MAX_RISE } from './weather/sealevel.js';
import { createPrecipitation } from './weather/precipitation.js';
import { Player } from './player/player.js';
import { HUD } from './ui/hud.js';
import { Ambience } from './audio/ambience.js';
import { ITEMS } from './items/items.js';
import { Inventory } from './items/inventory.js';
import { craft } from './items/recipes.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { BuildUI } from './ui/buildUI.js';
import { Joinery } from './ui/joinery.js';
import { createGathering } from './world/gathering.js';
import { createWoodMaterials } from './world/wood.js';
import { createTimber, woodName } from './world/timber.js';
import { createBuilding, PIECES, DECK_LEVELS } from './world/building.js';
import { createHeldItem } from './player/heldItem.js';
import { loadToolModels } from './items/models.js';
import { joinServer, createMatch } from './match/multiplayer.js';
import { MapUI } from './ui/mapUI.js';

// Multiplayer (?mp in the address): the game server decides the island, so
// ask it before generating anything (see match/multiplayer.js).
const params = new URLSearchParams(location.search);
if (params.has('mp')) document.querySelector('#overlay .play').textContent = 'Connecting…';
const server = params.has('mp') ? await joinServer() : null;
const seed = server?.seed ?? (Number(params.get('seed')) || 1337);
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

// The tree and tool models are the game's only asset files. Start loading
// them now, so they download and decode while the island is generated.
document.querySelector('#overlay .play').textContent = 'Loading…';
const treeModelsLoading = loadTreeModels(quality.anisotropy);
const toolModelsLoading = loadToolModels();

// Procedural textures, drawn on the GPU once at startup.
const baker = new TextureBaker(renderer);
const ground = bakeGround(baker, quality.texSize, quality.anisotropy);
const cloudTexture = bakeCloudNoise(baker);
uniforms.uCloudTex.value = cloudTexture;
const cloudShadows = quality.cloudShadows;

const terrain = createTerrain(rng, { ground, cloudShadows, castShadow: tier === 'high' });
scene.add(terrain.mesh);
const treeModels = await treeModelsLoading;
await toolModelsLoading;
const vegetation = createVegetation(scene, terrain, rng, { quality, ground, cloudShadows, treeModels });
const grass = createGrass(scene, terrain, { ...quality.grass, anisotropy: quality.anisotropy, msaa: quality.antialias, cloudShadows });
const ocean = createOcean(scene, terrain, rng, { ground, anisotropy: quality.anisotropy, cloudShadows });
// Water quality is its own setting (on the pause screen), remembered between visits.
const WATER_KEY = 'washed-away.water-quality';
let savedWater = null;
try { savedWater = localStorage.getItem(WATER_KEY); } catch { /* storage blocked */ }
const water = createWater(scene, terrain, renderer, savedWater || (tier === 'low' ? 'medium' : 'high'));
const splashes = createSplashes(scene);
const sky = createSky(scene, renderer, {
  cloudTexture, shadowMap: quality.shadowMap, shadowRange: quality.shadowRange, cloudShadows,
});
// The climate answers what you do to the island, and the weather and the
// sea follow it.
const climate = new ClimateEntity({ terrain, sources: vegetation.sources });
const weather = new Weather(rng, climate);
const sea = new SeaLevel(water);
const precip = createPrecipitation(scene, terrain, rng);
const player = new Player(camera, renderer.domElement, terrain, vegetation.colliders, water);
const hud = new HUD();
const audio = new Ambience();
const adaptive = new AdaptiveResolution(renderer, basePixelRatio, quality.minScale);
const gpuTimer = new GpuTimer(renderer);
const perf = createPerfOverlay(document.getElementById('perf'), { renderer, adaptive, gpuTimer, tier, gpu, water });

// Wood and building: felled trees come down as logs, the axe splits logs
// into planks where they lie, and you carry planks (and logs, for pilings)
// to blueprints to build. Each part has its own random numbers, so none of
// it changes the weather's.
const wood = createWoodMaterials(treeModels, { anisotropy: quality.anisotropy, cloudShadows });
const shadows = quality.shadowMap > 0;
const building = createBuilding(scene, {
  terrain, colliders: vegetation.colliders, wood, rng: mulberry32(seed + 2), shadows,
  takeWood: (kind) => timber.take(kind),
  release: (list) => timber.release(list),
  onMessage: (text) => hud.message(text, 6),
  onSound: (name, strength) => audio.wood(name, strength),
  onChange: () => timber.wake(),
  onImpact: (e) => climate.record(e),
});
// What things land on: the terrain, or a floor you've built.
const groundAt = (x, z, y) => Math.max(terrain.heightAt(x, z), building.floorAt(x, z, y + 0.3));
const timber = createTimber(scene, {
  terrain, water, forest: vegetation.forest, trees: vegetation.sources.trees, wood, groundAt, shadows,
  dropItem: (stack, from, velocity) => gathering.drop(stack, from, velocity),
  onSound: (name, strength) => audio.wood(name, strength),
  onImpact: (e) => climate.record(e),
  rng: mulberry32(seed + 3),
});
player.structures = building;
player.onBlackout = () => timber.dropAll(player.pos);

// Items: the bag with its hotbar and screen, and gathering from the world.
// Gathering has its own random numbers, so it doesn't change the weather's.
const inventory = new Inventory();
const gathering = createGathering(scene, {
  terrain, water, vegetation, inventory, timber, groundAt, rng: mulberry32(seed + 1),
  onImpact: (e) => climate.record(e),
});
const throwDir = new THREE.Vector3();
function throwStack(stack) {
  camera.getWorldDirection(throwDir);
  const from = camera.position.clone().addScaledVector(throwDir, 0.6);
  from.y -= 0.3;
  const velocity = throwDir.clone().multiplyScalar(3.2).add(player.vel);
  velocity.y += 1.4;
  gathering.drop(stack, from, velocity);
}
// Crafting: the new tool goes in the bag, or on the ground if there's no room.
function craftItem(recipe) {
  const stack = craft(inventory, recipe);
  if (!stack) return;
  const name = ITEMS[stack.id].name.toLowerCase();
  if (inventory.addStack(stack)) {
    throwStack(stack);
    hud.message(`No room in your bag: the ${name} is on the ground.`, 4);
  }
  inventoryUI.notify(`Crafted ${name}`);
}
const inventoryUI = new InventoryUI(inventory, { onDrop: throwStack, onCraft: craftItem });
const held = createHeldItem(scene, camera, wood);
// The selected tool's kind ('knife', 'axe', 'pickaxe'), if a tool is selected.
const selectedTool = () => ITEMS[inventory.current?.id]?.tool;

// Build mode (B): the chosen piece follows the crosshair as a see-through
// preview, and E places it as a blueprint to fill with planks (or logs).
// R turns a roof or raises pilings.
const buildUI = new BuildUI(PIECES);
const build = { on: false, piece: 0, turn: 0, plan: null };
function setBuilding(on) {
  build.on = on;
  build.plan = null;
  buildUI.show(on);
  building.preview(null);
}
function choosePiece(index) {
  build.piece = (index + PIECES.length) % PIECES.length;
}
function placeBlueprint() {
  const { plan } = build;
  if (!plan) return;
  if (!plan.ok) {
    hud.message(plan.reason, 2);
    return;
  }
  building.place(plan);
  const piece = PIECES[build.piece];
  inventoryUI.notify(`${piece.name} blueprint: ${piece.cost} ${piece.material ?? 'plank'}s to build`);
}
// The build bar's line about the chosen piece. For pilings: how high the
// deck will stand, against how far the sea may still rise.
function buildDetail() {
  const piece = PIECES[build.piece];
  if (piece.id !== 'pilings') return piece.hint;
  const deck = DECK_LEVELS[build.turn % DECK_LEVELS.length];
  return `Deck ${deck} m above the water (R to change). The sea may rise ${Math.max(0, MAX_RISE - sea.rise).toFixed(1)} m more, and storms surge 1.4 m above that.`;
}
// How everything built is holding up.
function buildStatus() {
  const { worn, lowest } = building.status();
  return worn ? `${worn} piece${worn === 1 ? ' needs' : 's need'} repairs (the worst is at ${Math.ceil(lowest * 100)}%)` : '';
}

// The joinery mini-game, for a finished piece or reworking one. You stay
// put while you work.
const joinery = new Joinery(mulberry32(seed + 4));
function startJoinery({ name, apply }) {
  player.setInput(false);
  joinery.start(name, (quality) => {
    player.setInput(true);
    const text = apply(quality);
    if (text) inventoryUI.notify(text);
  });
}

// What the climate's tiers say as it turns, and why it turned.
const TIER_UP = [
  null,
  'The climate is turning unstable. The weather is getting harder to predict, and the sea is rising.',
  'The climate has turned severe. Storms and heatwaves are coming harder and faster.',
  'The climate is in crisis. Hold on.',
];
const TIER_DOWN = [
  'The climate is settling back into balance.',
  'The climate is easing, but it’s still unstable.',
  'The worst has passed, but the climate is still severe.',
];
const CAUSES = {
  felling: 'Too many trees have come down.',
  mining: 'Too much of the ground has been dug up and stripped bare.',
  building: 'Too much of the island is built over.',
};
climate.onTier = (tier, previous, cause) => {
  hud.message(tier > previous ? `${TIER_UP[tier]} ${CAUSES[cause] ?? ''}`.trim() : TIER_DOWN[tier], 8);
};
weather.onChange = () => hud.message(`Weather shifting: ${weather.label}`);
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
// Multiplayer: the start screen is the lobby until the match starts.
const match = server && createMatch(server, { terrain, player, hud, overlay, scene, sea });
const map = new MapUI({ terrain, trees: vegetation.sources.trees, building, sea, climate, match });

function onPlay() {
  overlay.classList.add('hidden');
  if (!started) {
    started = true;
    hud.message(match?.intro ?? 'Day 1. Explore the island and the reef. Strip the island bare and the sea will wash it away.', 6);
  }
}
function startDragLook() {
  if (player.dragLook) return;
  player.dragLook = true;
  onPlay();
  hud.message('Mouse capture is blocked here. Hold the left button and drag to look. Esc pauses.', 7);
}
overlay.addEventListener('click', () => {
  if (!ready || match?.inLobby) return;
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
  map.close();
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
// Multiplayer has its own address (?mp), answered by the game server.
overlay.querySelector('.mode').addEventListener('click', (e) => {
  e.stopPropagation(); // don't start the game
  location.search = '?mp';
});

// What E and X act on: whichever is most squarely under the crosshair of
// the plants and items you can gather, the logs and planks lying about,
// and what you've built. Each offers { score, prompt, dim, act, hold }, and
// swing when the act is done with the tool in hand.
const aimRay = new THREE.Ray(), aimDir = new THREE.Vector3();
let focus = null;
function updateFocus() {
  const carrying = timber.carrying;
  const tool = carrying ? null : selectedTool();   // your hands are full
  focus = null;
  for (const option of [
    gathering.focus(player, camera, tool, weather.elapsed),
    timber.focus(aimRay, tool),
    building.focus(aimRay, carrying),
  ]) {
    if (option && (!focus || option.score > focus.score)) focus = option;
  }
  if (focus?.hands && carrying) {
    focus = { ...focus, dim: true, act: null, prompt: [['E', 'Your arms are full'], ['Q', `Put down a ${woodName(carrying.kind)}`]] };
  }
}

// What an action did: items gained, the tool used (it wears down),
// anything to tell you, and joints to make.
function report(result, tool) {
  if (!result) return;
  for (const { id, count } of result.got ?? []) inventoryUI.notify(`+${count} ${ITEMS[id].name}`);
  if (result.used) {
    // The tool that swung, wherever it is now.
    const slot = inventory.slots.indexOf(tool);
    if (slot >= 0 && inventory.wear(slot)) hud.message(`Your ${ITEMS[tool.id].name.toLowerCase()} broke.`, 4);
  }
  if (result.empty) hud.message('Nothing left to gather here. It grows back with time.', 3);
  else if (result.full) hud.message('Your bag is full.', 3);
  if (result.message) hud.message(result.message, 4);
  if (result.notify) inventoryUI.notify(result.notify);
  if (result.joinery) startJoinery(result.joinery);
}

// E: act on what you're looking at, or in build mode place the blueprint.
// Work done with a tool happens as the swing lands, not when it starts.
let lastUse = 0;
function interact() {
  if (performance.now() - lastUse < 300 || held.busy) return;
  lastUse = performance.now();
  if (build.on) {
    placeBlueprint();
  } else if (focus?.act) {
    const { act } = focus, tool = inventory.current;
    if (focus.swing) held.swing(() => report(act(), tool));
    else report(act(), tool);
  }
}

// Holding X takes apart what you built (or clears a blueprint).
const HOLD_TIME = 0.8;
const hold = { down: false, key: null, time: 0 };
function updateHold(dt) {
  if (!hold.down || !focus?.hold || build.on) {
    hold.key = null;
    hold.time = 0;
    return;
  }
  if (focus.key !== hold.key) {
    hold.key = focus.key;
    hold.time = 0;
  }
  hold.time += dt;
  if (hold.time >= HOLD_TIME) {
    report(focus.hold());
    hold.down = false;
    hold.time = 0;
  }
}

// What the prompt under the crosshair says: [actions, dim].
function promptFor(playing) {
  if (!playing) return [null];
  if (build.on) {
    const { plan } = build, piece = PIECES[build.piece];
    if (!plan) return [[['E', piece.id === 'floor' ? 'Aim at the ground or the water' : 'Aim at a floor']], true];
    if (!plan.ok) return [[['E', plan.reason]], true];
    const turn = piece.id === 'roof' ? [['R', 'Turn']] : piece.id === 'pilings' ? [['R', 'Raise or lower the deck']] : [];
    return [[['E', `Place ${piece.name.toLowerCase()} blueprint`], ...turn]];
  }
  if (!focus) return [null];
  if (hold.time > 0) return [[['X', `Taking apart… ${Math.round((hold.time / HOLD_TIME) * 100)}%`]]];
  return [focus.prompt, focus.dim];
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
// inventory, E gathers, chops, picks up, builds and repairs, Q drops one of
// the selected item (or puts down wood you're carrying), B builds (1-8 or
// the wheel pick the piece, R turns a roof or raises pilings), holding X
// takes apart, K opens the map, P toggles the performance readout, M mutes.
// In the joinery mini-game, E or Space works and X skips.
//
// Dev mode, for testing, is off and out of sight until ` is pressed five
// times in quick succession (five more turn it off). Then ` and 1-7 forces
// a weather type (` and 4 again during a storm makes it worse), T skips an
// hour and G sends a rogue wave set.
const DEV_TAPS = 5;
let devMode = false, devTaps = [], devArmed = -Infinity;
const devBadge = document.getElementById('dev-badge');
function setDevMode(on) {
  devMode = on;
  devArmed = -Infinity;
  overlay.querySelector('.dev').hidden = !on;
  devBadge.hidden = !on;
  hud.message(on ? 'Dev mode on: ` then 1–7 forces the weather, T skips an hour, G sends a rogue wave set.' : 'Dev mode off.', on ? 7 : 3);
}
addEventListener('keyup', (e) => {
  if (e.code === 'KeyX') hold.down = false;
});
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;   // typing your name in the lobby
  if (e.code === 'Backquote' && !e.repeat) {
    const now = performance.now();
    devTaps = devTaps.filter((t) => now - t < 2500);
    devTaps.push(now);
    if (devTaps.length >= DEV_TAPS) {
      devTaps = [];
      setDevMode(!devMode);
      return;
    }
  }
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
  if (joinery.open) {
    if (!e.repeat && (e.code === 'KeyE' || e.code === 'Space')) joinery.act();
    else if (e.code === 'KeyX') joinery.skip();
    return;
  }
  if (e.code === 'KeyI' || e.code === 'Tab') {
    if (inventoryUI.open) {
      closeInventory();
    } else {
      setBuilding(false);
      openInventory();
    }
    return;
  }
  const digit = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0;
  if (e.code === 'Backquote') {
    if (devMode) devArmed = performance.now();
    return;
  }
  if (devMode && digit && performance.now() - devArmed < 1500) {
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
  if (digit >= 1 && build.on) {
    if (digit <= PIECES.length) choosePiece(digit - 1);
  } else if (digit >= 1) {
    inventory.select(digit - 1);
  } else if (e.code === 'KeyE') {
    interact();
  } else if (e.code === 'KeyB') {
    setBuilding(!build.on);
  } else if (e.code === 'KeyR') {
    if (build.on) build.turn++;
  } else if (e.code === 'KeyX') {
    if (!e.repeat) hold.down = true;
  } else if (e.code === 'KeyQ') {
    if (timber.carrying) {
      camera.getWorldDirection(throwDir);
      timber.putDown(camera.position, throwDir, player.vel);
    } else {
      const stack = inventory.take(inventory.selected, 1);
      if (stack) throwStack(stack);
    }
  } else if (e.code === 'KeyK') {
    map.toggle();
  } else if (e.code === 'KeyM') {
    hud.message(audio.toggleMute() ? 'Sound off' : 'Sound on', 2);
  } else if (devMode && e.code === 'KeyT') {
    sky.skip(1);
  } else if (devMode && e.code === 'KeyG') {
    water.waves.spawnRogue(camera.position);
    hud.message('A rogue wave set is rolling in from upwind.', 4);
  }
});

addEventListener('wheel', (e) => {
  if (!isPlaying() || inventoryUI.open || joinery.open || !e.deltaY) return;
  if (build.on) choosePiece(build.piece + Math.sign(e.deltaY));
  else inventory.select(inventory.selected + Math.sign(e.deltaY));
}, { passive: true });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
// Right-click eats (or leaves build mode); in build mode with the mouse
// captured, left-click places too. In the joinery mini-game a click works.
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!isPlaying() || inventoryUI.open) return;
  if (joinery.open) {
    if (e.button === 0) joinery.act();
  } else if (e.button === 2) {
    if (build.on) setBuilding(false);
    else useSelected();
  } else if (e.button === 0 && build.on && player.controls.isLocked) {
    interact();
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
  climate.update(sdt, { rain: weather.current.rain, x: player.pos.x, z: player.pos.z });
  sea.update(sdt, weather, sky.state.time);
  player.burden = timber.burden;
  player.update(sdt, t, weather.heatIndex);
  uniforms.uPlayerPos.value.copy(player.pos);
  gathering.update(sdt, t);
  timber.update(sdt, t, player);
  building.update(sdt, sea, weather);
  joinery.update(sdt);

  // What's under the crosshair, or where a blueprint would go.
  // (With the map up you can still move, but not act on what's in front of you.)
  const playing = isPlaying() && !inventoryUI.open && !joinery.open && !map.open;
  camera.getWorldDirection(aimDir);
  aimRay.set(camera.position, aimDir);
  focus = null;
  if (playing && build.on) {
    build.plan = building.plan(PIECES[build.piece].id, aimRay, build.turn);
    building.preview(build.plan);
    buildUI.select(build.piece, buildDetail());
    buildUI.status(buildStatus());
  } else if (playing) {
    updateFocus();
  }
  updateHold(sdt);
  inventoryUI.setPrompt(...promptFor(playing));
  const carrying = timber.carrying;
  inventoryUI.setCarrying(carrying && `Carrying ${carrying.count} ${woodName(carrying.kind, carrying.count)} · Q to put down`);
  inventoryUI.update(dt);
  map.update(dt, player, camera);
  match?.update(dt);
  held.update(sdt, inventory.current, Math.hypot(player.vel.x, player.vel.z), timber.carried);
  precip.update(sdt, t, camera, weather);
  const env = sky.update(sdt, camera, weather.current, precip.flash);
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
  hud.update(dt, { weather, sea, climate, clock: sky.clock(), player, waves: water.waves });
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
sky.update(0, camera, weather.current, 0);
renderer.compileAsync(scene, camera).catch(() => {}).finally(() => {
  ready = true;
  playLabel.textContent = 'Click to play';
  requestAnimationFrame(frame);
});

if (import.meta.env.DEV) {
  window.game = {
    scene, camera, renderer, terrain, weather, sea, player, sky, water, uniforms, vegetation, step, inventory, gathering,
    timber, building, build, joinery, held, climate, match, map, get devMode() { return devMode; },
    counts: vegetation.counts, quality: { tier, gpu, adaptive, gpuTimer },
  };
}
