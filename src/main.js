import * as THREE from 'three';
import './style.css';
import { mulberry32, uniforms } from './shared.js';
import {
  TIERS, detectGPU, autoTier, pickTier, shortGPU, loadGraphics, saveGraphics, measureRefresh,
  AdaptiveResolution, GpuTimer, createPerfOverlay,
} from './core/quality.js';
import { TextureBaker, bakeGround, bakeCloudNoise } from './world/textures.js';
import { installShadowFilter } from './world/materials.js';
import { createTerrain } from './world/terrain.js';
import { createVegetation } from './world/vegetation.js';
import { loadTreeModels } from './world/trees.js';
import { createGrass } from './world/grass.js';
import { createOcean } from './world/ocean.js';
import { createWater, WATER_QUALITY } from './world/water.js';
import { createSplashes } from './world/splash.js';
import { createSky } from './world/sky.js';
import { Weather, WEATHER_KEYS, SIGNAL_ADVICE } from './weather/weather.js';
import { ClimateEntity } from './climate/entity.js';
import { SeaLevel, MAX_RISE } from './weather/sealevel.js';
import { createPrecipitation } from './weather/precipitation.js';
import { Player } from './player/player.js';
import { HUD } from './ui/hud.js';
import { Ambience } from './audio/ambience.js';
import { Tutorial, SOLO, MATCH } from './ui/tutorial.js';
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
import { createKuboMaterials } from './world/kubo.js';
import { createHeldItem } from './player/heldItem.js';
import { createSpears } from './world/spears.js';
import { SPEAR, spearSpeed } from './match/rules.js';
import { loadToolModels } from './items/models.js';
import { joinServer, createMatch } from './match/multiplayer.js';
import { MapUI } from './ui/mapUI.js';
import { createTrailer } from './trailer/trailer.js';
import { Menu } from './ui/menu.js';
import { Scoreboard } from './ui/scoreboard.js';

// The menu is up from the start, while the island is made: its own pages
// work at once, and Singleplayer waits until the island is ready.
const params = new URLSearchParams(location.search);
let ready = false;     // the island is made and its shaders compiled
let started = false;   // you've started playing (so it's the pause menu now)
const menu = new Menu({ onAction: (name, button) => menuAction(name, button) });
menu.open(...(params.has('mp') ? ['lobby'] : params.has('trailer') ? ['trailer'] : Menu.remembered() ?? ['main']));
const singleButton = menu.button('single');
singleButton.disabled = true;

// Multiplayer (?mp in the address): the game server decides the island, so
// ask it before generating anything (see match/multiplayer.js).
if (params.has('mp')) menu.status('Connecting to the game server…');
const server = params.has('mp') ? await joinServer() : null;
const seed = server?.seed ?? (Number(params.get('seed')) || 1337);
const rng = mulberry32(seed);

// Graphics settings for the GPU the browser actually hands us, or the ones
// chosen in Settings > Graphics.
const graphics = loadGraphics();
const gpu = detectGPU();
const tier = pickTier(gpu, graphics.preset);
// The tier's settings, with anti-aliasing (which leaves and grass follow) as chosen.
const antialias = graphics.antialias === 'auto' ? TIERS[tier].antialias : graphics.antialias === 'on';
const quality = { ...TIERS[tier], antialias };
const basePixelRatio = Math.min(devicePixelRatio, quality.pixelRatio);

const renderer = new THREE.WebGLRenderer({ antialias, powerPreference: 'high-performance' });
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
menu.status('Making the island…');
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
// Water quality is its own setting (Settings > Water), remembered between
// visits. High only by default on a dedicated graphics card: it costs
// integrated graphics several frames a second.
const WATER_KEY = 'washed-away.water-quality';
let savedWater = null;
try { savedWater = localStorage.getItem(WATER_KEY); } catch { /* storage blocked */ }
const water = createWater(scene, terrain, renderer, savedWater || (tier === 'high' ? 'high' : 'medium'));
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
adaptive.setTarget(graphics.target);
const gpuTimer = new GpuTimer(renderer);
const perf = createPerfOverlay(document.getElementById('perf'), { renderer, adaptive, gpuTimer, tier, gpu, water, antialias });
perf.show(graphics.readout);

// Wood and building: felled trees come down as logs, the axe splits logs
// into planks where they lie, and you carry planks (and logs, for pilings)
// to blueprints to build. Each part has its own random numbers, so none of
// it changes the weather's.
const wood = createWoodMaterials(treeModels, { anisotropy: quality.anisotropy, cloudShadows });
const shadows = quality.shadowMap > 0;
const building = createBuilding(scene, {
  terrain, colliders: vegetation.colliders, wood, rng: mulberry32(seed + 2), shadows,
  kubo: createKuboMaterials({ anisotropy: quality.anisotropy, cloudShadows }),
  takeWood: (kind) => timber.take(kind),
  release: (list) => timber.release(list),
  onMessage: (text) => hud.message(text, 6),
  onSound: (name, strength) => audio.wood(name, strength),
  onChange: () => timber.wake(),
  onImpact: (e) => {
    climate.record(e);
    if (e.area > 0 && !e.remote) tutorial.event('built');
  },
});
// What things land on: the terrain, or a floor you've built.
const groundAt = (x, z, y) => Math.max(terrain.heightAt(x, z), building.floorAt(x, z, y + 0.3));
const timber = createTimber(scene, {
  terrain, water, forest: vegetation.forest, trees: vegetation.sources.trees, wood, groundAt, shadows,
  dropItem: (stack, from, velocity) => gathering.drop(stack, from, velocity),
  onSound: (name, strength) => audio.wood(name, strength),
  onImpact: (e) => {
    climate.record(e);
    tutorial.event('felled');
  },
  onChop: (tree, from) => match?.chopped(tree, from),
  rng: mulberry32(seed + 3),
});
player.structures = building;
player.onBlackout = () => {
  timber.dropAll(player.pos);
  // After the player's own "you blacked out" message, in place of it.
  if (!match) setTimeout(() => endRun('You blacked out and woke up on the shore'));
};

// Items: the bag with its hotbar and screen, and gathering from the world.
// Gathering has its own random numbers, so it doesn't change the weather's.
const inventory = new Inventory();
const gathering = createGathering(scene, {
  terrain, water, vegetation, inventory, timber, groundAt, rng: mulberry32(seed + 1),
  onImpact: (e) => climate.record(e),
});
const throwDir = new THREE.Vector3();
// Some things can't be dropped or thrown out (your team's bed).
const keepsWithYou = (id) => hud.message(`The ${ITEMS[id].name.toLowerCase()} stays with you: right-click to place it.`, 3);
function throwStack(stack) {
  if (ITEMS[stack.id].keep) {
    inventory.add(stack.id, stack.count);   // back in the bag
    keepsWithYou(stack.id);
    return;
  }
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
// The selected tool's kind ('knife', 'axe', 'pickaxe', 'spear'), if a tool is selected.
const selectedTool = () => ITEMS[inventory.current?.id]?.tool;
// The selected item is thrown, not swung (the spear).
const throwing = () => !!ITEMS[inventory.current?.id]?.throws;

// Thrown spears: in flight, stuck where they struck, and picked up again.
// In a match a throw can hit another team's player (match/bedwars.js).
const spears = createSpears(scene, {
  terrain, water, colliders: vegetation.colliders, building, inventory,
  dropItem: (stack, from, velocity) => gathering.drop(stack, from, velocity),
  strike: (ray, length) => match?.spearStrike(ray, length) ?? null,
  onSound: (name, strength) => {
    if (name === 'splash') audio.splash(strength * 6);
    else if (name === 'throw') audio.whoosh(strength);
    else audio.wood(name, strength);
  },
  onBroken: () => hud.message('Your spear broke where it struck.', 3),
});

// Build mode (B): the chosen piece follows the crosshair as a see-through
// preview, and E places it as a blueprint to fill with planks (or logs).
// R turns any piece (each starts unturned); Z raises pilings, a step at a
// time back round to the lowest.
const buildUI = new BuildUI(PIECES);
const build = { on: false, piece: 0, turn: 0, raise: 0, plan: null };
function setBuilding(on) {
  build.on = on;
  build.plan = null;
  buildUI.show(on);
  building.preview(null);
}
function choosePiece(index) {
  const piece = (index + PIECES.length) % PIECES.length;
  if (piece !== build.piece) build.turn = 0;
  build.piece = piece;
}
// What R does to each piece.
const TURNS = { floor: 'Turn the boards', roof: 'Turn the ridge', pilings: 'Turn the braces' };
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
  const deck = DECK_LEVELS[build.raise % DECK_LEVELS.length];
  return `Deck ${deck} m above the water (Z to change). The sea may rise ${Math.max(0, MAX_RISE - sea.rise).toFixed(1)} m more, and storms surge 1.4 m above that.`;
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
  stripping: 'Too much of the ground has been stripped bare.',
  building: 'Too much of the island is built over.',
};
// (A multiplayer match's storm says what's coming in its own words.)
climate.onTier = (tier, previous, cause) => {
  if (match) return;
  hud.message(tier > previous ? `${TIER_UP[tier]} ${CAUSES[cause] ?? ''}`.trim() : TIER_DOWN[tier], 8);
};
weather.onChange = () => hud.message(`Weather shifting: ${weather.label}`);
// The wind signals as a storm's winds rise, with what each calls for.
let signalShown = 0;
function announceSignal() {
  const signal = weather.signal;
  if (signal > signalShown) hud.message(`Wind Signal No. ${signal} is raised. ${SIGNAL_ADVICE[signal]}`, 7);
  else if (!signal && signalShown) hud.message('All wind signals are lifted.', 4);
  signalShown = signal;
}
precip.onStrike = (distance) => audio.thunder(distance);
sea.onSurge = () => hud.message('Storm surge! The sea is pushing inland.', 5);
player.onMessage = (text) => hud.message(text, 5);
player.onStep = (surface, strength) => audio.step(surface, strength);
player.onSplash = (x, y, z, speed) => {
  splashes.emit(x, y, z, speed);
  audio.splash(speed);
};

// On integrated graphics, point out the dedicated GPU setting.
if (autoTier(gpu) !== 'high' && /Intel|AMD Radeon\(TM\) Graphics|AMD Radeon Graphics/i.test(gpu)) {
  menu.hint(
    `Running on ${shortGPU(gpu)}. If this PC also has an NVIDIA or AMD graphics card, set your browser to ` +
    '"High performance" in Windows Settings > System > Display > Graphics for a much smoother game.',
  );
}

// Playing and pausing. Pointer lock is preferred; where the browser
// refuses it (e.g. embedded previews) we fall back to drag-to-look.
// The inventory frees the mouse but doesn't pause: the world keeps going.
const isPlaying = () => player.controls.isLocked || player.dragLook || inventoryUI.open;
player.enableDragLook(renderer.domElement);
// Multiplayer: the menu holds the lobby until the match starts.
const match = server && createMatch(server, {
  terrain, player, hud, menu: menu.root, scene, sea, camera, weather, building, inventory, spears, timber, sky,
  trees: vegetation.sources.trees, sound: (name, ...args) => audio[name]?.(...args),
});
if (match) menu.button('quit').textContent = 'Leave the match';
const map = new MapUI({ terrain, trees: vegetation.sources.trees, building, sea, climate, match });
// Tips for a first game (H hides them).
const tutorial = new Tutorial(match ? MATCH : SOLO);
// The trailer (?trailer): scripted shots through the game, recorded to a
// video file (trailer/trailer.js).
const trailer = params.has('trailer') && !server ? createTrailer({
  scene, camera, renderer, terrain, water, sea, sky, weather, player, held, inventory, timber, building, spears, vegetation, ocean, audio, uniforms,
}) : null;

function onPlay() {
  menu.close();
  if (!started) {
    started = true;
    hud.message(match?.intro ?? 'Day 1. Explore the island and the reef. Strip the island bare and the sea will wash it away.', 6);
    if (!match?.spectating) tutorial.begin();
  }
}
const pause = () => menu.open('pause');
function startDragLook() {
  if (player.dragLook) return;
  player.dragLook = true;
  onPlay();
  hud.message('Mouse capture is blocked here. Hold the left button and drag to look. Esc pauses.', 7);
}
// Singleplayer, Resume, or Play once a match is on: take the mouse and go.
function play() {
  if (!ready || match?.inLobby) return;
  audio.start();
  try {
    const request = renderer.domElement.requestPointerLock();
    request?.catch?.(startDragLook);
  } catch {
    startDragLook();
  }
}

// What the menu's buttons do (ui/menu.js). A click on the game beside the
// panel resumes it, as Resume does.
let quitClicked = -Infinity;
function menuAction(name, button) {
  if (name === 'single' || name === 'resume') {
    play();
  } else if (name === 'outside') {
    if (ready && (menu.page === 'pause' || menu.page === 'lobby')) play();
  } else if (name === 'bedwars') {
    location.search = '?mp';   // multiplayer has its own address, answered by the game server
  } else if (name === 'trailer-preview' || name === 'trailer-record') {
    playTrailer(name === 'trailer-record');
  } else if (name === 'keybinds') {
    menu.keybinds(true);
  } else if (name === 'quit') {
    // Twice, to be sure: nothing on your island is kept.
    if (performance.now() - quitClicked > 3000) {
      quitClicked = performance.now();
      const label = button.textContent;
      button.classList.add('confirm');
      button.textContent = match ? 'Click again to leave' : 'Click again: your island isn’t kept';
      setTimeout(() => {
        button.classList.remove('confirm');
        button.textContent = label;
      }, 3000);
      return;
    }
    if (!match && started) endRun();
    location.href = location.pathname;   // the main menu, without ?mp
  }
}

// The score on your own (ui/scoreboard.js): a new day's points as it
// comes, the line under the clock, and the run's end (blacking out, or
// quitting) onto the leaderboard.
const scoreboard = new Scoreboard(document.getElementById('leaderboard'));
const scoreLine = !server && !trailer ? document.getElementById('score') : null;
function keepScore() {
  if (!started || !isPlaying()) return;
  const standing = building.standing;
  const gain = scoreboard.update(sky.state.day, standing, climate.tier);
  if (gain) hud.message(`A new day: +${gain} points for the ${standing} piece${standing === 1 ? '' : 's'} you have standing (×${[1, 0.6, 0.3, 0.1][climate.tier]} for the climate).`, 6);
  const text = `Score ${scoreboard.score} · +${scoreboard.next(standing, climate.tier)} tomorrow · best ${scoreboard.best}`;
  if (scoreLine.textContent !== text) scoreLine.textContent = text;
  scoreLine.hidden = false;
}
function endRun(why = 'Your run is over') {
  const run = scoreboard.end();
  if (!run) return;
  const place = run.rank ? ` (#${run.rank} on your leaderboard)` : '';
  hud.message(`${why}: ${run.score} points over ${run.days} day${run.days === 1 ? '' : 's'}${place}. A new run starts now.`, 8);
}
addEventListener('pagehide', () => { if (!match && started) scoreboard.end(); });

// The trailer page: plays it, or records it, at full resolution, then
// comes back here.
// from: seconds in to start at (for looking at one shot).
function playTrailer(record, from = 0) {
  if (!ready || !trailer || trailer.running) return;
  audio.start();
  menu.close();
  adaptive.setTarget('off');
  trailer.play({ record, from }, (file) => {
    adaptive.setTarget(graphics.target);
    dispatchEvent(new Event('resize'));
    menu.open('trailer');
    document.getElementById('trailer-note').textContent = file
      ? `Saved washed-away-trailer.${file.type.startsWith('video/mp4') ? 'mp4' : 'webm'} (${(file.size / 1e6).toFixed(1)} MB) to your downloads.`
      : 'That was the preview. Record it when you like.';
  });
}

// Settings > Water.
const WATER_NOTES = {
  low: 'Fewer waves on a coarser surface, with simpler ripples: the quickest to draw.',
  medium: 'More waves and finer ripples. The default on integrated graphics.',
  high: 'The most waves, on the finest surface. The default on a graphics card.',
};
menu.options(document.getElementById('water-options'), [{
  label: 'Water quality',
  choices: Object.entries(WATER_QUALITY).map(([key, { label }]) => [key, label]),
  get: () => water.quality,
  set: (value) => {
    water.setQuality(value);
    try { localStorage.setItem(WATER_KEY, water.quality); } catch { /* storage blocked */ }
  },
  note: (value) => WATER_NOTES[value],
}]);

// Settings > Graphics. Quality and anti-aliasing are set as the game
// loads: before you've started on your own, it loads again at once (and
// comes back here); otherwise they wait for next time.
function setOnLoad(key, value) {
  graphics[key] = value;
  saveGraphics(graphics);
  if (!started && !server) {
    menu.remember();
    location.reload();
    return;
  }
  const note = document.getElementById('graphics-restart');
  note.hidden = false;
  note.textContent = 'Quality and anti-aliasing change the next time the game loads.';
}
function showReadout(on) {
  perf.show(on);
  graphics.readout = on;
  saveGraphics(graphics);
}
const autoLabel = TIERS[autoTier(gpu)].label;
const renderGraphics = menu.options(document.getElementById('graphics-options'), [
  {
    label: 'Quality',
    choices: [['auto', `Auto (${autoLabel})`], ...Object.entries(TIERS).map(([key, { label }]) => [key, label])],
    get: () => graphics.preset,
    set: (value) => setOnLoad('preset', value),
    note: () => `Texture detail, shadows, grass and how far trees are drawn. Auto picks ${autoLabel} for ${shortGPU(gpu)}.`,
  },
  {
    label: 'Anti-aliasing',
    choices: [['auto', `Auto (${TIERS[tier].antialias ? 'on' : 'off'})`], ['on', 'On'], ['off', 'Off']],
    get: () => graphics.antialias,
    set: (value) => setOnLoad('antialias', value),
    note: () => 'Smooths jagged edges. Off draws a good deal faster on integrated graphics.',
  },
  {
    label: 'Dynamic resolution',
    choices: () => [['screen', `Your screen (${adaptive.refresh} fps)`], [120, '120 fps'], [60, '60 fps'], ['off', 'Off']],
    get: () => graphics.target,
    set: (value) => {
      graphics.target = value;
      saveGraphics(graphics);
      adaptive.setTarget(value);
    },
    note: (value) => (value === 'off'
      ? 'Always draws at full resolution, however slow that is.'
      : `Draws at a lower resolution (down to ${Math.round(quality.minScale * 100)}%) while the frame rate is below this, and goes back up when there’s room.`),
  },
  {
    label: 'Performance readout',
    choices: [['off', 'Off'], ['on', 'On']],
    get: () => (perf.visible ? 'on' : 'off'),
    set: (value) => showReadout(value === 'on'),
    note: () => 'Frame rate, render scale and graphics card, at the bottom left (P).',
  },
]);
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
  pause();
}
function closeInventory({ resume = true } = {}) {
  inventoryUI.hide();
  player.setInput(true);
  if (!resume) {
    pause();
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
  else pause();
});

// What E, X and a swing act on: whichever is most squarely under the
// crosshair of the plants and items you can gather, the logs and planks
// lying about, and what you've built. Each offers { score, prompt, dim,
// act, hold, use }: act for E (your hands), hold for holding X, use for a
// swing of the tool in hand.
const aimRay = new THREE.Ray(), aimDir = new THREE.Vector3();
let focus = null;
let bedAim = null;   // where your team's bed would go, while it's selected in a match
let kuboAim = null;  // where your team's bahay kubo would go, likewise
function updateFocus() {
  const carrying = timber.carrying;
  // Your hands are full; and a spear is thrown, not swung at things.
  const tool = carrying || throwing() ? null : selectedTool();
  focus = null;
  for (const option of [
    gathering.focus(player, camera, tool, weather.elapsed),
    timber.focus(aimRay, tool),
    building.focus(aimRay, carrying, tool),
    spears.focus(aimRay),
  ]) {
    if (option && (!focus || option.score > focus.score)) focus = option;
  }
  if (focus?.hands && carrying) {
    focus = { ...focus, dim: true, act: null, use: null, prompt: [['E', 'Your arms are full'], ['Q', `Put down a ${woodName(carrying.kind)}`]] };
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

// E is for your hands: gather, pick up and build (in build mode, place the
// blueprint). Tools are for swinging (right-click, below).
let lastUse = 0;
function interact() {
  if (performance.now() - lastUse < 300 || held.busy) return;
  lastUse = performance.now();
  if (build.on) placeBlueprint();
  else if (focus?.act) report(focus.act());
}

// A swing of what's in your hand: right-click with a tool, left-click or F
// with the spear (a jab), and in a match left-click or F with anything (a
// fist, if no tool). It lands partway through: in a match on another
// team's player or bed, or on anything built in the way
// (match/bedwars.js); otherwise on what the tool works on, as it was under
// the crosshair when you swung: a tree to fell, a log to split, grass or a
// bush to cut, something built to break (the spear only breaks things).
function swing() {
  if (held.busy || build.on || drawing) return;
  if (timber.carrying) {
    hud.message(`Your arms are full: put the ${woodName(timber.carrying.kind, 2)} down first (Q).`, 3);
    return;
  }
  const tool = inventory.current, kind = selectedTool();
  const work = !kind ? null : throwing() ? building.focus(aimRay, null, kind)?.use : focus?.use;
  if (!kind && !match?.fighting) return;   // a fist only strikes, in a match
  match?.acted();
  held.swing(() => {
    if (match?.fighting && match.strike(aimRay, kind ?? 'none')) {
      report({ used: !!kind }, tool);
      tutorial.event('struck');
    } else if (work) {
      report(work(), tool);
    }
  });
}

// The spear: holding right-click draws it back, the meter under the
// crosshair filling over SPEAR.draw seconds, and letting go throws it as
// hard as it was drawn (world/spears.js), wearing it a little. Anything
// that takes your hands or the spear away lets it down without a throw.
const meter = document.getElementById('throw-meter'), meterFill = meter.querySelector('i');
let drawing = null;   // { t: seconds held }, while drawing the spear back
const drawnBack = () => Math.min(1, drawing.t / SPEAR.draw);
function drawBack() {
  if (drawing || held.busy || build.on) return;
  if (timber.carrying) {
    hud.message(`Your arms are full: put the ${woodName(timber.carrying.kind, 2)} down first (Q).`, 3);
    return;
  }
  drawing = { t: 0 };
  match?.drawing(true);
}
function letGo(throwIt) {
  if (!drawing) return;
  const charge = drawnBack();
  drawing = null;
  held.draw(0);
  match?.drawing(false);
  meter.hidden = true;
  if (throwIt && throwing()) throwSpear(charge);
}
const throwFrom = new THREE.Vector3(), throwSide = new THREE.Vector3();
function throwSpear(charge) {
  const stack = inventory.take(inventory.selected, 1);
  if (!stack) return;
  stack.durability = (stack.durability ?? ITEMS[stack.id].durability) - 1;
  // From your right hand, just ahead of your eye, the way you're looking.
  camera.getWorldDirection(throwDir);
  throwSide.crossVectors(throwDir, camera.up).normalize();
  throwFrom.copy(camera.position).addScaledVector(throwDir, 0.9).addScaledVector(throwSide, 0.18);
  throwFrom.y -= 0.08;
  const velocity = throwDir.clone().multiplyScalar(spearSpeed(charge)).add(player.vel);
  spears.throw(camera.position, throwFrom, velocity, stack);
  match?.throwSpear(throwFrom, velocity, charge);
  tutorial.event('threw');
}
addEventListener('mouseup', (e) => {
  if (e.button === 2) letGo(true);
});

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
    if (!plan) return [[['E', piece.id === 'floor' || piece.id === 'pilings' ? 'Aim at the ground or the water' : 'Aim at a floor']], true];
    const turn = [['R', TURNS[piece.id] ?? 'Turn it round the floor'], ...(piece.id === 'pilings' ? [['Z', 'Raise or lower the deck']] : [])];
    if (!plan.ok) return [[['E', plan.reason], ...turn], true];
    return [[['E', `Place ${piece.name.toLowerCase()} blueprint`], ...turn]];
  }
  if (bedAim) return bedAim.ok ? [[['Right-click', 'Place your team’s bed'], ['R', 'Turn']]] : [[['Right-click', bedAim.reason], ['R', 'Turn']], true];
  if (kuboAim) return kuboAim.ok ? [[['Right-click', 'Put up your team’s bahay kubo'], ['R', 'Turn the door']]] : [[['Right-click', kuboAim.reason], ['R', 'Turn the door']], true];
  if (drawing) return [[['Right-click', 'Let go to throw']]];
  if (!focus) return throwing() && !timber.carrying ? [[['Right-click', 'Hold to draw the spear back, let go to throw'], ['Click', 'Jab']], true] : [null];
  if (hold.time > 0) return [[['X', `Taking apart… ${Math.round((hold.time / HOLD_TIME) * 100)}%`]]];
  return [focus.prompt, focus.dim];
}

// Eating: a handful at most this often (ms), so it takes a moment to heal.
const EAT_GAP = 1000;
let lastAte = -Infinity;

// Right-click: use the selected item. Swing a tool, draw back the spear
// (held), eat food, or in a match put up your team's bahay kubo or bed.
function useSelected() {
  const stack = inventory.current;
  if (stack?.id === 'bed') {
    match?.placeBed(aimRay);
    return;
  }
  if (stack?.id === 'kubo') {
    match?.placeKubo(aimRay);
    return;
  }
  if (throwing()) {
    drawBack();
    return;
  }
  if (selectedTool()) {
    swing();
    return;
  }
  const food = stack && ITEMS[stack.id].eat;
  if (!food || performance.now() - lastAte < EAT_GAP) return;
  lastAte = performance.now();
  inventory.take(inventory.selected, 1);
  player.eat(food);
  inventoryUI.notify(`Ate ${ITEMS[stack.id].name.toLowerCase()}${food.health ? ` (+${food.health} health)` : ''}`);
  tutorial.event('ate');
}

// Keys: 1-9 or the mouse wheel pick a hotbar slot, I or Tab open the
// inventory, E gathers, picks up, builds and repairs (by hand), Q drops one
// of the selected item (or puts down wood you're carrying), B builds (1-8
// or the wheel pick the piece, R turns it, Z raises pilings), holding X
// takes apart, F strikes (in a match), K opens the map, P toggles the
// performance readout, M mutes. In the joinery mini-game, E or Space works
// and X skips. Knocked out in a match, you can't do anything until you're
// back. With the menu up, Esc goes back a page. Settings > Keybinds lists
// them all (but not dev mode's).
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
  menu.dev(on);
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
  if (e.code === 'KeyP') showReadout(!perf.visible);
  if (e.code === 'Tab') e.preventDefault();
  if (e.code === 'Escape') {
    if (menu.visible) {
      menu.escape();
      return;
    }
    if (inventoryUI.open) {
      closeInventory({ resume: false });
      return;
    }
    if (player.dragLook) {
      player.dragLook = false;
      pause();
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
  if (player.dead) return;
  // Watching: only the map, mute and the tips (the spectator flies on WASD).
  if (match?.spectating && !['KeyK', 'KeyM', 'KeyH'].includes(e.code)) return;
  if (digit >= 1 && build.on) {
    if (digit <= PIECES.length) choosePiece(digit - 1);
  } else if (digit >= 1) {
    inventory.select(digit - 1);
  } else if (e.code === 'KeyE') {
    interact();
  } else if (e.code === 'KeyF') {
    if (!e.repeat && (match || throwing())) swing();
  } else if (e.code === 'KeyB') {
    setBuilding(!build.on);
  } else if (e.code === 'KeyR') {
    if (build.on) build.turn++;
    else if (inventory.current?.id === 'bed') match?.turnBed();
    else if (inventory.current?.id === 'kubo') match?.turnKubo();
  } else if (e.code === 'KeyZ') {
    if (build.on) build.raise++;
  } else if (e.code === 'KeyX') {
    if (!e.repeat) hold.down = true;
  } else if (e.code === 'KeyQ') {
    if (timber.carrying) {
      camera.getWorldDirection(throwDir);
      timber.putDown(camera.position, throwDir, player.vel);
    } else if (ITEMS[inventory.current?.id]?.keep) {
      keepsWithYou(inventory.current.id);
    } else {
      const stack = inventory.take(inventory.selected, 1);
      if (stack) throwStack(stack);
    }
  } else if (e.code === 'KeyK') {
    map.toggle();
  } else if (e.code === 'KeyM') {
    hud.message(audio.toggleMute() ? 'Sound off' : 'Sound on', 2);
  } else if (e.code === 'KeyH') {
    tutorial.hide();
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
// Right-click uses the selected item: swings a tool, eats, or puts up the
// bed or bahay kubo (in build mode it leaves build mode). With the mouse
// captured, left-click places in build mode, jabs with the spear, and
// strikes in a match. In the joinery mini-game a click works.
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!isPlaying() || inventoryUI.open || player.dead) return;
  // Watching: click follows the next player, right-click flies freely.
  if (match?.spectating) {
    if (e.button === 0) match.followNext();
    else if (e.button === 2) match.flyFreely();
    return;
  }
  if (joinery.open) {
    if (e.button === 0) joinery.act();
  } else if (e.button === 2) {
    if (build.on) setBuilding(false);
    else useSelected();
  } else if (e.button === 0 && player.controls.isLocked) {
    if (build.on) interact();
    else if (match || throwing()) swing();
  }
});

addEventListener('resize', () => {
  for (const view of [camera, menuCamera]) {
    view.aspect = innerWidth / innerHeight;
    view.updateProjectionMatrix();
  }
  renderer.setSize(innerWidth, innerHeight);
});

// Until you start, the menu looks out to sea through a camera of its own
// (yours stays where you'll start): from just off the island's west
// shore, low over the swell and riding it, with the morning sun behind,
// so the sky and the sea are at their bluest.
const menuCamera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
const menuView = (() => {
  // Out from the middle of the island, away from the sun (which rises
  // towards +x, a little to +z: see world/sky.js), to where it has been
  // deep water for a while.
  const ux = -0.95 / Math.hypot(0.95, 0.3), uz = -0.3 / Math.hypot(0.95, 0.3);
  let r = 80;
  for (let deep = 0; r < 1100 && deep < 120; r += 5) deep = terrain.heightAt(ux * r, uz * r) < -12 ? deep + 5 : 0;
  return { x: ux * r, z: uz * r, yaw: Math.atan2(-ux, -uz) + 0.35, pitch: 0.03, height: 1.8, y: null, along: 0, across: 0 };
})();
const menuSurface = {};
function updateMenuView(dt) {
  const v = menuView, s = water.surface(v.x, v.z, t, menuSurface);
  const k = Math.min(1, dt * 2.5);
  v.y = v.y === null ? s.height : v.y + (s.height - v.y) * k;
  // Tipping with the slope of the swell under it, ahead and to the side.
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  v.along += (s.slopeX * fx + s.slopeZ * fz - v.along) * k;
  v.across += (s.slopeX * -fz + s.slopeZ * fx - v.across) * k;
  menuCamera.position.set(v.x, v.y + v.height, v.z);
  menuCamera.rotation.set(v.pitch + v.along * 0.3, v.yaw, v.across * 0.3, 'YXZ');
}

const underwaterColor = new THREE.Color('#1f6878');
const clock = new THREE.Clock();
let t = 0;
let shadowFrame = 0;
let drawn = false;

function frame() {
  step();
  requestAnimationFrame(frame);
}

function step() {
  const dt = Math.min(clock.getDelta(), 0.05);
  // While paused, waves and particles keep moving but the simulation stops.
  const sdt = isPlaying() || trailer?.running ? dt : 0;
  t += dt;
  uniforms.uTime.value = t;

  weather.update(sdt);
  announceSignal();
  // In a multiplayer match the climate follows the match's storm, the same
  // for every team, instead of what anyone does (match/rules.js).
  if (match) climate.follow(sdt, match.pressure, { x: player.pos.x, z: player.pos.z });
  else climate.update(sdt, { rain: weather.current.rain, x: player.pos.x, z: player.pos.z });
  sea.update(sdt, weather, sky.state.time);
  player.burden = timber.burden;
  // Watching a match, the camera is the spectator's; otherwise it's your eyes.
  if (trailer?.running) trailer.update(dt);
  else if (match?.spectating) match.spectate(sdt, player.keys);
  else player.update(sdt, t, weather.heatIndex);
  uniforms.uPlayerPos.value.copy(player.pos);
  gathering.update(sdt, t);
  timber.update(sdt, t, player);
  spears.update(sdt, t);
  building.update(sdt, sea, weather);
  joinery.update(sdt);

  // What's under the crosshair, or where a blueprint would go.
  // (With the map up you can still move, but not act on what's in front of
  // you; knocked out in a match, neither.)
  const playing = isPlaying() && !inventoryUI.open && !joinery.open && !map.open && !player.dead && !match?.spectating && !trailer?.running;
  camera.getWorldDirection(aimDir);
  aimRay.set(camera.position, aimDir);
  focus = null;
  if (playing && build.on) {
    build.plan = building.plan(PIECES[build.piece].id, aimRay, build.turn, build.raise);
    if (match) build.plan = match.checkPlan(build.plan);
    building.preview(build.plan);
    buildUI.select(build.piece, buildDetail());
    buildUI.status(buildStatus());
  } else if (playing) {
    updateFocus();
  }
  updateHold(sdt);
  // The spear being drawn back: the meter fills while you hold.
  if (drawing) {
    if (!playing || !throwing() || timber.carrying || build.on) {
      letGo(false);
    } else {
      drawing.t += dt;
      const level = drawnBack();
      held.draw(level);
      meter.hidden = false;
      meterFill.style.width = `${level * 100}%`;
      meter.classList.toggle('full', level >= 1);
    }
  }
  // Your team's bed, selected in a match: where it would go.
  bedAim = match?.aimBed(playing && !build.on && !timber.carrying && inventory.current?.id === 'bed' ? aimRay : null) ?? null;
  kuboAim = match?.aimKubo(playing && !build.on && !timber.carrying && inventory.current?.id === 'kubo' ? aimRay : null) ?? null;
  inventoryUI.setPrompt(...promptFor(playing));
  const carrying = timber.carrying;
  inventoryUI.setCarrying(carrying && `Carrying ${carrying.count} ${woodName(carrying.kind, carrying.count)} · Q to put down`);
  inventoryUI.update(dt);
  map.update(dt, player, camera);
  match?.update(dt);
  if (playing) tutorial.update(sdt, { player, inventory, open: !!match?.opened });
  held.update(sdt, match?.spectating ? null : inventory.current, Math.hypot(player.vel.x, player.vel.z), timber.carried);
  // What's drawn from: your eyes, or until you start, the menu's view.
  const view = started || trailer?.running ? camera : menuCamera;
  if (view === menuCamera) updateMenuView(dt);
  precip.update(sdt, t, view, weather);
  const env = sky.update(sdt, view, weather.current, precip.flash);
  weather.dayF = env.dayF;
  water.update(view, weather, env, precip.flash, sdt);
  ocean.update(t, view, sea.level);
  vegetation.update(view);
  grass.update(view);
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
  if (scoreLine) keepScore();
  hud.update(dt, { weather, sea, climate, regions: !match, forecast: match?.forecast, clock: sky.clock(), player, waves: water.waves });
  gpuTimer.begin(perf.visible);
  renderer.render(scene, view);
  trailer?.frame();
  gpuTimer.end();
  adaptive.update(dt);
  perf.update(dt);
  if (!drawn) {
    drawn = true;
    menu.live();
  }
}

// Compile every shader before the first frame (in parallel where the
// browser allows), so nothing stalls when new things come into view. Then,
// before anything is drawn, time the screen's refresh rate, which the
// dynamic resolution aims for.
sea.update(0, weather, sky.state.time);
sky.update(0, camera, weather.current, 0);
renderer.compileAsync(scene, camera).catch(() => {}).finally(async () => {
  const hz = await measureRefresh();
  if (hz) adaptive.refresh = hz;
  renderGraphics();
  ready = true;
  singleButton.disabled = false;
  menu.status('');
  requestAnimationFrame(frame);
});

if (import.meta.env.DEV) {
  window.game = {
    scene, camera, renderer, terrain, weather, sea, player, sky, water, uniforms, vegetation, step, inventory, gathering, audio, tutorial,
    timber, building, build, joinery, held, climate, match, map, menu, menuView, menuCamera, spears, trailer, playTrailer, get devMode() { return devMode; },
    counts: vegetation.counts, quality: { tier, gpu, adaptive, gpuTimer, graphics },
  };
}
