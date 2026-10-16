import * as THREE from 'three';
import { uniforms, smoothstep, lerp, CLOUD_HEIGHT } from '../shared.js';
import { createAtmosphere, skyRadiance, sunTransmittance, SKY_LUT_GLSL } from './atmosphere.js';
import { CLOUD_COVERAGE_GLSL } from './materials.js';

const DAY_LENGTH = 720;   // seconds of daylight+dusk per full cycle (nights run faster)
const SUN_E = 3.2;        // sunlight above the atmosphere, in scene units
const SKY_GAIN = 1.6;     // sky brightness (makes up for the multiple scattering we skip)
const AMBIENT_GAIN = 1.5; // extra fill light from the sky and the ground
const MOON = new THREE.Color('#9fb4ff');
const NIGHT_SKY = new THREE.Color(0.0035, 0.0055, 0.012);
const GROUND = new THREE.Color(0.11, 0.12, 0.07);   // bounce light colour (forest and sand)
const HAZE = new THREE.Color('#e9b27a');
const MIST = new THREE.Color('#c9d1d6');

// Sky colour by direction, shared by the sky dome and water reflections.
// Needs uniforms.* for the sky; the caller supplies the fog colour.
export const SKY_GLSL = /* glsl */ `
uniform sampler2D uSkyLUT;
uniform float uSkyScale;
uniform vec3 uSunDir;
uniform vec3 uLightDir;
uniform vec3 uNightSky;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform float uMistAmount;
uniform sampler2D uCloudTex;
uniform float uCloudCover;
uniform float uCloudDark;
uniform vec2 uCloudOffset;
uniform vec3 uCloudSun;
uniform vec3 uCloudAmb;
${SKY_LUT_GLSL}
${CLOUD_COVERAGE_GLSL}
vec3 btSkyBase( vec3 d ) {
  return btSkyLUT( uSkyLUT, d, uSunDir ) * uSkyScale + uNightSky;
}
// A cloud layer at a fixed height, shaded with one extra lookup towards the sun.
vec4 btClouds( vec3 d ) {
  if ( d.y < 0.015 ) return vec4( 0.0 );
  vec2 p = d.xz * ( ${CLOUD_HEIGHT.toFixed(1)} / d.y ) + uCloudOffset;
  float base = texture2D( uCloudTex, p * ( 1.0 / 5200.0 ) ).r;
  float detail = texture2D( uCloudTex, p * ( 1.0 / 1300.0 ) + vec2( 0.31, 0.17 ) ).g;
  float dens = btCloudCoverage( base + ( detail - 0.5 ) * 0.3, uCloudCover );
  if ( dens < 0.002 ) return vec4( 0.0 );
  vec2 toSun = normalize( uSunDir.xz + 1e-4 ) * 320.0;
  float occl = btCloudCoverage( texture2D( uCloudTex, ( p + toSun ) * ( 1.0 / 5200.0 ) ).r, uCloudCover );
  float lit = exp( -occl * 1.8 - dens * 0.7 ) * smoothstep( -0.12, 0.1, uSunDir.y );
  float silver = pow( max( dot( d, uSunDir ), 0.0 ), 10.0 ) * 1.4 * ( 1.0 - 0.7 * dens );
  vec3 col = uCloudAmb * ( 1.1 - 0.4 * dens ) + uCloudSun * ( lit * 0.75 + silver ) * 0.3;
  col *= 1.0 - uCloudDark * 0.7;
  return vec4( col, dens * smoothstep( 0.015, 0.14, d.y ) );
}
// Near and below the horizon the sky fades into the fog colour; thick fog
// or haze hides most of the sky.
vec3 btHorizon( vec3 d, vec3 col ) {
  vec3 fc = mix( uFogColor, uFogSunColor, pow( max( dot( d, uLightDir ), 0.0 ), 6.0 ) );
  float band = 1.0 - smoothstep( -0.03, 0.07 + 0.9 * uMistAmount, d.y );
  float k = band * mix( 0.65, 1.0, max( uCloudCover * uCloudCover, uMistAmount ) );
  return mix( col, fc, max( k, uMistAmount * 0.92 ) );
}
`;

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w;
}`;

const skyFrag = /* glsl */ `
${SKY_GLSL}
uniform vec3 uSunDisc;
uniform float uSunCos;
uniform float uSunVis;
uniform float uMoonVis;
uniform float uStars;
uniform float uFlash;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  vec3 col = btSkyBase( d );
  // The swollen sun, with darkened limb and a tight glow.
  float sd = dot( d, uSunDir );
  float disc = smoothstep( uSunCos - 0.0015, uSunCos + 0.0005, sd );
  float r = clamp( ( 1.0 - sd ) / ( 1.0 - uSunCos ), 0.0, 1.0 );
  col += uSunDisc * ( disc * ( 1.0 - 0.5 * r * r ) + pow( max( sd, 0.0 ), 3000.0 ) * 0.08 ) * uSunVis;
  // Moon and stars.
  float md = dot( d, -uSunDir );
  col += vec3( 0.55, 0.58, 0.65 ) * smoothstep( 0.99955, 0.9997, md ) * uMoonVis;
  col += vec3( 0.02, 0.025, 0.035 ) * pow( max( md, 0.0 ), 200.0 ) * uMoonVis;
  vec3 sp = floor( d * 220.0 );
  float star = step( 0.9975, fract( sin( dot( sp, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) );
  col += star * uStars * 0.25 * smoothstep( 0.0, 0.2, d.y );
  vec4 cl = btClouds( d );
  col = mix( col, cl.rgb, cl.a );
  col = btHorizon( d, col );
  col += uFlash * vec3( 0.55, 0.6, 0.75 );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
const setRGB = (color, a, scale = 1) => color.setRGB(a[0] * scale, a[1] * scale, a[2] * scale);

// Sky dome, sun and moon light, sky light, fog colours, sun shadows and
// tone-mapping exposure, all following the time of day and the weather.
export function createSky(scene, renderer, { cloudTexture, shadowMap = 0, shadowRange = 50, cloudShadows = true } = {}) {
  const hemi = new THREE.HemisphereLight('#bfe3ff', '#3d4a32', 1);
  const sun = new THREE.DirectionalLight('#fff4e2', SUN_E);
  scene.add(hemi, sun, sun.target);

  if (shadowMap > 0) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMap, shadowMap);
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -shadowRange;
    cam.right = cam.top = shadowRange;
    cam.near = 1;
    cam.far = 900;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02 * (shadowRange / 40) * (1024 / shadowMap);
    cam.updateProjectionMatrix();
  }
  uniforms.uShadowRange.value = shadowMap > 0 ? shadowRange * 0.95 : 0;
  uniforms.uCloudTex.value = cloudTexture;
  uniforms.uCloudShadow.value = cloudShadows ? 0.8 : 0;

  const atmosphere = createAtmosphere(renderer);
  uniforms.uSkyLUT.value = atmosphere.texture;
  uniforms.uSkyScale.value = SUN_E * SKY_GAIN;

  const skyUniforms = {
    uSunDisc: { value: new THREE.Color() },
    uSunCos: { value: 0.998 }, uSunVis: { value: 1 }, uMoonVis: { value: 0 },
    uStars: { value: 0 }, uFlash: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1400, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: { ...skyUniforms, ...uniforms }, vertexShader: skyVert, fragmentShader: skyFrag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    }),
  );
  dome.frustumCulled = false;
  // Drawn after everything else that's opaque, so sky pixels hidden behind
  // terrain and trees fail the depth test instead of being shaded.
  dome.renderOrder = 1000;
  scene.add(dome);

  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), lightDir = new THREE.Vector3();
  const state = { time: 0.3, day: 1 };
  const fogColor = new THREE.Color(), tmp = new THREE.Color(), tmp2 = new THREE.Color();
  const top = new THREE.Color(), horizon = new THREE.Color(), lightColor = new THREE.Color();

  // Atmosphere colours depend only on the sun's height and the haze, so
  // they are recomputed only when those change.
  const atm = {
    y: 2, mie: -1, tSun: [0, 0, 0], zenith: new THREE.Color(), skyIrr: new THREE.Color(),
    toward: new THREE.Color(), away: new THREE.Color(),
  };
  const v = new THREE.Vector3(), s = new THREE.Vector3(), out = [0, 0, 0];
  function sample(elev, toward) {
    v.set(Math.cos(elev) * (toward ? 1 : -1), Math.sin(elev), 0);
    return skyRadiance(v, s, atm.mie, out);
  }
  function updateAtmosphereColors(y, mie) {
    if (Math.abs(y - atm.y) < 0.0005 && Math.abs(mie - atm.mie) < 0.01) return;
    atm.y = y;
    atm.mie = mie;
    s.set(Math.sqrt(Math.max(0, 1 - y * y)), y, 0);
    sunTransmittance(s, mie, atm.tSun);
    const k = SUN_E * SKY_GAIN;
    v.set(0, 1, 0);
    setRGB(atm.zenith, skyRadiance(v, s, mie, out), k);
    // Sky light on a level surface, from a few sample directions.
    const irr = atm.skyIrr.copy(atm.zenith).multiplyScalar(0.3);
    for (const [elev, wgt] of [[0.45, 0.2], [0.09, 0.15]]) {
      irr.add(setRGB(tmp, sample(elev, true), k * wgt));
      irr.add(setRGB(tmp, sample(elev, false), k * wgt));
    }
    irr.multiplyScalar(Math.PI * AMBIENT_GAIN);
    // Real skylight is less saturated than single scattering alone gives
    // (light scatters many times, and bounces off the ground).
    irr.lerp(tmp.setScalar(lum(irr)), 0.3);
    setRGB(atm.toward, sample(0.05, true), k);
    setRGB(atm.away, sample(0.05, false), k);
  }

  function update(dt, camera, w, flash, instability) {
    // Nights pass 2.5x faster so the game stays playable.
    const prevElev = Math.sin((state.time - 0.25) * Math.PI * 2);
    state.time += (dt / DAY_LENGTH) * (prevElev < -0.05 ? 2.5 : 1);
    if (state.time >= 1) { state.time -= 1; state.day += 1; }

    const ang = (state.time - 0.25) * Math.PI * 2;
    sunDir.set(Math.cos(ang), Math.sin(ang), 0.3).normalize();
    moonDir.copy(sunDir).negate();
    const elev = sunDir.y;
    const dayF = smoothstep(-0.08, 0.2, elev);
    const isDay = elev > -0.05;
    lightDir.copy(isDay ? sunDir : moonDir);

    // Hazy air (heatwave, fog) scatters more and whitens the sky.
    const mie = 1 + w.haze * 5 + w.mist * 3;
    atmosphere.update(sunDir, mie);
    updateAtmosphereColors(elev, mie);
    const t = atm.tSun;
    const cover = w.cloud, dark = w.dark;

    // Direct light: sunlight through the atmosphere by day, the moon by night.
    const sunlightH = SUN_E * (t[0] * 0.2126 + t[1] * 0.7152 + t[2] * 0.0722) * Math.max(0, elev);
    const globalShade = cloudShadows ? 1 : 1 - 0.75 * cover;
    if (isDay) {
      sun.color.setRGB(t[0], t[1], t[2]);
      sun.intensity = SUN_E * w.sunMul * globalShade * smoothstep(-0.05, 0.02, elev);
    } else {
      sun.color.copy(MOON);
      sun.intensity = 0.3 * smoothstep(-0.05, -0.2, elev) * (1 - cover * 0.7);
    }

    // Sky light: blue from a clear sky, grey from under the clouds.
    const cloudBase = ((sunlightH + lum(atm.skyIrr)) * 0.28) / Math.PI;
    const moonAmb = 0.05 * smoothstep(-0.05, -0.25, elev);
    hemi.color.copy(atm.skyIrr).lerp(tmp.setScalar(cloudBase * Math.PI), cover * 0.9)
      .multiplyScalar(1 - 0.55 * dark).add(tmp.setRGB(0.6, 0.7, 1).multiplyScalar(moonAmb * (1 - 0.6 * cover)))
      .add(tmp.setRGB(0.012, 0.016, 0.03));
    hemi.groundColor.copy(GROUND).multiplyScalar(sunlightH * w.sunMul * (1 - 0.75 * cover) + lum(hemi.color));
    hemi.intensity = 1 + flash * 3;

    // Clouds: lit tops take the sun's colour; undersides the diffuse light.
    uniforms.uCloudSun.value.setRGB(t[0], t[1], t[2]).multiplyScalar(SUN_E);
    uniforms.uCloudAmb.value.setScalar(cloudBase * (1 - 0.5 * dark) + moonAmb * 0.2 + 0.004)
      .lerp(tmp.copy(atm.zenith).multiplyScalar(0.6), 0.15 * (1 - cover));
    uniforms.uCloudCover.value = cover;
    uniforms.uCloudDark.value = dark;
    const speed = 2 + w.wind * 22;
    const off = uniforms.uCloudOffset.value;
    off.addScaledVector(uniforms.uWindDir.value, -speed * dt);
    off.set(off.x % 5200, off.y % 5200);

    // Fog: the sky colour at the horizon, greyed by clouds, amber in a
    // heatwave, white in mist.
    const grey = tmp2.setScalar(cloudBase * (1 - 0.55 * dark) + moonAmb * 0.15);
    const weatherFog = (c) => {
      c.add(NIGHT_SKY).lerp(grey, Math.min(1, cover * 0.95));
      c.lerp(tmp.copy(HAZE).multiplyScalar(lum(c) * 1.5 + 0.02), w.haze * 0.8);
      c.lerp(tmp.copy(MIST).multiplyScalar(cloudBase * 1.3 + 0.01), w.mist * 0.85);
      return c.lerp(tmp.setRGB(1, 1, 1), flash * 0.5);
    };
    weatherFog(fogColor.copy(atm.away));
    weatherFog(uniforms.uFogSunColor.value.copy(atm.toward));
    // Heatwave haze veils the sky like a thin mist (amber, from the fog colour).
    uniforms.uMistAmount.value = Math.max(w.mist, w.haze * 0.5);

    const su = skyUniforms;
    uniforms.uFogColor.value.copy(fogColor);
    su.uSunDisc.value.setRGB(t[0], t[1], t[2]).multiplyScalar(SUN_E * 14);
    // The swelling sun: noticeably bigger than ours, growing with solar output.
    su.uSunCos.value = Math.cos(0.055 * w.sunScale * (1 + 0.35 * instability));
    su.uSunVis.value = smoothstep(-0.1, 0.02, elev) * (1 - w.mist * 0.8);
    su.uMoonVis.value = smoothstep(0.0, -0.15, elev) * (1 - w.mist * 0.8);
    su.uStars.value = smoothstep(-0.05, -0.25, elev) * (1 - cover) * (1 - w.mist);
    su.uFlash.value = flash;
    uniforms.uNightSky.value.copy(NIGHT_SKY).multiplyScalar(1 + 2 * su.uMoonVis.value);
    dome.position.copy(camera.position);

    uniforms.uSunDir.value.copy(sunDir);
    uniforms.uLightDir.value.copy(lightDir);
    uniforms.uSunlight.value = dayF * (1 - 0.78 * cover);

    // Sun shadows: a box around (and a little ahead of) the player, moved in
    // whole shadow-map texels so edges don't crawl.
    placeLight(camera);

    top.copy(atm.zenith).lerp(grey, cover);
    horizon.copy(fogColor);
    return {
      fogColor, dayF, sunElevation: elev, top, horizon, lightDir,
      lightColor: lightColor.copy(sun.color).multiplyScalar(sun.intensity),
      // For water highlights: the sun or moon disc, hidden by mist (clouds are per pixel).
      lightVis: isDay ? su.uSunVis.value * (cloudShadows ? 1 : 1 - 0.9 * cover) : su.uMoonVis.value * 0.35,
      // Eyes adapt: brighter exposure at night and under storm clouds.
      exposure: lerp(1.9, 1, dayF) * (1 + 0.45 * dark * dayF),
    };
  }

  const fwd = new THREE.Vector3(), center = new THREE.Vector3(), lightRot = new THREE.Matrix4();
  const invRot = new THREE.Matrix4(), origin = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function placeLight(camera) {
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    center.copy(camera.position).addScaledVector(fwd, shadowRange * 0.35);
    if (shadowMap > 0) {
      // Snap the centre to the shadow map's texel grid, in light space.
      lightRot.lookAt(origin, lightDir, up);
      invRot.copy(lightRot).invert();
      center.applyMatrix4(invRot);
      const texel = (2 * shadowRange) / shadowMap;
      center.x = Math.round(center.x / texel) * texel;
      center.y = Math.round(center.y / texel) * texel;
      center.applyMatrix4(lightRot);
    }
    uniforms.uShadowCenter.value.set(center.x, center.z);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(lightDir, 400);
  }

  function clock() {
    const hours = (state.time * 24) % 24; // time 0 = midnight, 0.25 = 6am
    return { day: state.day, hours: Math.floor(hours), minutes: Math.floor((hours % 1) * 60) };
  }

  function skip(hours) { state.time = (state.time + hours / 24) % 1; }

  return { update, clock, skip, dome, state, sun };
}
