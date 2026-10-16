import * as THREE from 'three';
import { uniforms, range } from '../shared.js';

// GPU-animated particles: seeds live in a box that wraps around the camera,
// so the CPU only updates a few uniforms per frame.

const RAIN_COUNT = 7000;
const SNOW_COUNT = 6000;

const rainVert = /* glsl */ `
attribute vec4 aSeed;
attribute float aEnd;
uniform float uTime;
uniform float uSpeed;
uniform float uLen;
uniform float uDensity;
uniform float uWater;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform vec2 uWindV;
varying float vAlpha;
void main() {
  vec3 vel = vec3( uWindV.x, -uSpeed, uWindV.y );
  vec3 p = aSeed.xyz * uBox + uOffset;
  vec3 rel = mod( p - uCam + uBox * 0.5, uBox ) - uBox * 0.5;
  vec3 wp = uCam + rel - normalize( vel ) * uLen * aEnd;
  vAlpha = step( aSeed.w, uDensity ) * step( uWater, wp.y ) * ( 1.0 - smoothstep( 18.0, 30.0, length( rel.xz ) ) );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

const snowVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uSpeed;
uniform float uDensity;
uniform float uWater;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uOffset;
uniform vec2 uWindV;
varying float vAlpha;
void main() {
  vec3 p = aSeed.xyz * uBox + uOffset;
  p.x += sin( uTime * 0.8 + aSeed.w * 40.0 ) * 0.8;
  p.z += cos( uTime * 0.6 + aSeed.w * 30.0 ) * 0.8;
  vec3 rel = mod( p - uCam + uBox * 0.5, uBox ) - uBox * 0.5;
  vec3 wp = uCam + rel;
  vAlpha = step( aSeed.w, uDensity ) * step( uWater, wp.y );
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  gl_PointSize = min( 24.0, ( 0.6 + aSeed.w * 0.8 ) * 40.0 / max( -mv.z, 0.1 ) );
  gl_Position = projectionMatrix * mv;
}`;

const fragHead = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
`;
const rainFrag = fragHead + /* glsl */ `
void main() {
  if ( vAlpha < 0.01 ) discard;
  gl_FragColor = vec4( uColor, uOpacity * vAlpha );
  #include <colorspace_fragment>
}`;
const snowFrag = fragHead + /* glsl */ `
void main() {
  float d = length( gl_PointCoord - 0.5 );
  if ( d > 0.5 || vAlpha < 0.01 ) discard;
  gl_FragColor = vec4( uColor, uOpacity * vAlpha * smoothstep( 0.5, 0.2, d ) );
  #include <colorspace_fragment>
}`;

function particleUniforms(box, color, opacity, speed) {
  return {
    uTime: { value: 0 }, uSpeed: { value: speed }, uLen: { value: 0.9 }, uDensity: { value: 0 },
    uWater: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uOffset: { value: new THREE.Vector3() },
    uWindV: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity },
  };
}

function createRain(rng) {
  const seeds = new Float32Array(RAIN_COUNT * 8);
  const ends = new Float32Array(RAIN_COUNT * 2);
  for (let i = 0; i < RAIN_COUNT; i++) {
    const s = [rng(), rng(), rng(), rng()];
    seeds.set(s, i * 8);
    seeds.set(s, i * 8 + 4);
    ends[i * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RAIN_COUNT * 6), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: particleUniforms(new THREE.Vector3(60, 40, 60), '#aebfd0', 0.55, 32),
    vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 2;
  return lines;
}

function createSnow(rng) {
  const seeds = new Float32Array(SNOW_COUNT * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rng();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SNOW_COUNT * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: particleUniforms(new THREE.Vector3(70, 40, 70), '#f4f8ff', 0.9, 2.2),
    vertexShader: snowVert, fragmentShader: snowFrag, transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 2;
  return points;
}

export function createPrecipitation(scene, terrain, rng) {
  const rain = createRain(rng);
  const snow = createSnow(rng);
  scene.add(rain, snow);

  const boltGeo = new THREE.BufferGeometry();
  boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
  const bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: '#eef3ff', fog: false }));
  bolt.frustumCulled = false;
  bolt.visible = false;
  scene.add(bolt);

  const state = { flash: 0, boltTime: 0, reflash: -1, onStrike: null, lastT: 0 };

  function strike(camera, waterLevel) {
    const ang = rng() * Math.PI * 2, dist = range(rng, 120, 420);
    const x = camera.position.x + Math.cos(ang) * dist;
    const z = camera.position.z + Math.sin(ang) * dist;
    const ground = Math.max(terrain.heightAt(x, z), waterLevel);
    const pos = boltGeo.attributes.position;
    let bx = x, bz = z;
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      pos.setXYZ(i, bx, 160 + (ground - 160) * t, bz);
      bx += range(rng, -7, 7); bz += range(rng, -7, 7);
    }
    pos.needsUpdate = true;
    bolt.visible = true;
    state.boltTime = 0.2;
    state.flash = 1;
    state.reflash = 0.12;
    state.onStrike?.(dist);
  }

  function update(dt, t, camera, weather) {
    const c = weather.current;
    const wind = uniforms.uWindDir.value;
    const waterLevel = uniforms.uWaterLevel.value;
    const ptime = t % 600;
    // Particles keep falling while paused, so they step with real time.
    const pdt = Math.min(0.05, Math.max(0, t - state.lastT));
    state.lastT = t;

    for (const [obj, density, drift] of [[rain, c.rain, 14], [snow, c.snow, 9]]) {
      const u = obj.material.uniforms;
      u.uTime.value = ptime;
      u.uDensity.value = density;
      u.uWater.value = waterLevel;
      u.uCam.value.copy(camera.position);
      u.uWindV.value.set(wind.x, wind.y).multiplyScalar(weather.gustWind * drift);
      // Integrate the motion here (wrapped to the box) so gusts speed the
      // particles up smoothly instead of teleporting the whole field.
      const o = u.uOffset.value, box = u.uBox.value, v = u.uWindV.value;
      o.set((o.x + v.x * pdt) % box.x, (o.y - u.uSpeed.value * pdt) % box.y, (o.z + v.y * pdt) % box.z);
      obj.visible = density > 0.01;
    }

    if (c.lightning > 0.01 && rng() < c.lightning * dt) strike(camera, waterLevel);
    if (state.reflash > 0 && (state.reflash -= dt) <= 0) state.flash = 0.7;
    state.flash *= Math.exp(-dt * 9);
    if (state.boltTime > 0 && (state.boltTime -= dt) <= 0) bolt.visible = false;
  }

  return {
    update,
    get flash() { return state.flash; },
    set onStrike(fn) { state.onStrike = fn; },
  };
}
