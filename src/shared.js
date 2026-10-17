import * as THREE from 'three';

// World layout (1 unit = 1 metre).
export const WORLD = {
  size: 720,          // terrain spans -size/2..size/2 on X and Z
  segments: 360,      // terrain grid cells per side (2 m cells, smooth shaded)
  islandRadius: 210,
  maxRadius: 340,     // player can't swim past this
  abyssDepth: -48,
};

// Prevailing directions (radians in the XZ plane): the open-ocean swell, and
// the local wind that raises the wind sea. The weather's wind wanders around
// windDir, so waves and wind stay roughly aligned.
export const SEA = { swellDir: 0.6, windDir: 1.05 };

// Height of the cloud layer above sea level (m). The sky, the water
// reflections and the cloud shadows on the ground all use it.
export const CLOUD_HEIGHT = 1400;

// Uniforms shared by every weather-reactive material. Materials hold
// references to these objects, so updating .value updates them all.
export const uniforms = {
  uTime: { value: 0 },
  uWind: { value: 0.2 },                         // 0 calm .. 1 storm
  uWindDir: { value: new THREE.Vector2(1, 0) },  // normalized XZ
  uWave: { value: 0.4 },                         // wave amplitude in metres
  uWaterLevel: { value: 0 },
  uSnow: { value: 0 },                           // snow cover 0..1
  uWet: { value: 0 },                            // ground wetness 0..1
  uDry: { value: 0 },                            // drought 0..1
  uSunlight: { value: 1 },                       // direct light reaching the sea
  uBleach: { value: 0 },                         // coral heat stress 0..1
  // Flooding (set by weather/sealevel.js). Salt water kills the ground
  // plants it reaches (they regrow slowly as the salt line drops) and the
  // trees whose roots it reaches (they stay dead).
  uSaltLine: { value: 0 },
  uTreeKillLine: { value: 0 },

  // Light and atmosphere (set by world/sky.js).
  uLightDir: { value: new THREE.Vector3(0, 1, 0) },  // towards the sun, or the moon at night
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },    // towards the sun, day or night
  uSkyLUT: { value: null },                          // sky radiance by direction, relative to the sun
  uSkyScale: { value: 1 },                           // sky LUT -> scene radiance
  uNightSky: { value: new THREE.Color() },
  // Fog colour (linear; three's own fogColor uniform is already sRGB-encoded,
  // but this game fogs before tone mapping) and looking towards the light.
  uFogColor: { value: new THREE.Color() },
  uFogSunColor: { value: new THREE.Color() },
  uMistAmount: { value: 0 },                         // fog bank hiding the horizon 0..1

  // Cloud layer.
  uCloudTex: { value: null },
  uCloudCover: { value: 0 },
  uCloudDark: { value: 0 },
  uCloudOffset: { value: new THREE.Vector2() },
  uCloudSun: { value: new THREE.Color() },           // sunlight on the cloud tops
  uCloudAmb: { value: new THREE.Color() },           // ambient light under the clouds
  uCloudShadow: { value: 0.8 },                      // how dark cloud shadows get

  // Sun shadow map coverage: centre XZ and radius where shadows fade out.
  uShadowCenter: { value: new THREE.Vector2() },
  uShadowRange: { value: 60 },

  // Vegetation level of detail: near meshes fade into billboards over this range.
  uLodRange: { value: new THREE.Vector2(55, 65) },
  // Player position, for grass pushed aside underfoot.
  uPlayerPos: { value: new THREE.Vector3() },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export const range = (rng, a, b) => a + (b - a) * rng();
