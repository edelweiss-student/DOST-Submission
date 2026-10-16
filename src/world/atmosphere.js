import * as THREE from 'three';

// Single-scattering atmosphere (Rayleigh + Mie + ozone) over a spherical
// Earth. The GPU renders it into a small sky-view table (azimuth from the
// sun x elevation) that the sky dome and water reflections look up; the CPU
// runs the same maths for the handful of directions that set the light,
// ambient and fog colours. Radiance is relative to the sun's irradiance
// above the atmosphere.

const RG = 6360e3, RT = 6460e3, EYE = 100;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];   // Rayleigh scattering
const BO = [0.650e-6, 1.881e-6, 0.085e-6];   // ozone absorption
const BMS = 3.996e-6, BME = 4.4e-6;          // Mie scattering / extinction
const VIEW_STEPS = 24, SUN_STEPS = 8;

export const LUT_SIZE = { width: 64, height: 48 };

const lutFragment = /* glsl */ `
varying vec2 vUv;
uniform vec3 uSun;
uniform float uMie;
const float PI = 3.14159265;
const float RG = ${RG.toFixed(1)}, RT = ${RT.toFixed(1)};
const vec3 BR = vec3( ${BR.map((v) => v.toExponential(4)).join(', ')} );
const vec3 BO = vec3( ${BO.map((v) => v.toExponential(4)).join(', ')} );
const float BMS = ${BMS.toExponential(4)}, BME = ${BME.toExponential(4)};

float rayExit( vec3 o, vec3 d, float r ) {
  float b = dot( o, d ), c = dot( o, o ) - r * r;
  return -b + sqrt( max( b * b - c, 0.0 ) );
}
float rayGround( vec3 o, vec3 d ) {
  float b = dot( o, d ), c = dot( o, o ) - RG * RG, disc = b * b - c;
  if ( disc < 0.0 ) return -1.0;
  float t = -b - sqrt( disc );
  return t > 0.0 ? t : -1.0;
}
vec3 extinction( float h ) {
  return BR * exp( -h / 8000.0 ) + BME * uMie * exp( -h / 1200.0 ) + BO * max( 0.0, 1.0 - abs( h - 25000.0 ) / 15000.0 );
}
vec3 sunTransmittance( vec3 p, vec3 s ) {
  if ( rayGround( p, s ) > 0.0 ) return vec3( 0.0 );
  float tmax = rayExit( p, s, RT );
  vec3 od = vec3( 0.0 );
  for ( int i = 0; i < ${SUN_STEPS}; i ++ ) {
    float a = float( i ) / ${SUN_STEPS}.0, b = float( i + 1 ) / ${SUN_STEPS}.0;
    float t0 = tmax * a * a, t1 = tmax * b * b;
    od += extinction( length( p + s * ( 0.5 * ( t0 + t1 ) ) ) - RG ) * ( t1 - t0 );
  }
  return exp( -od );
}
void main() {
  float az = vUv.x * PI;
  float v = vUv.y * 2.0 - 1.0;
  float el = sign( v ) * v * v * PI * 0.5;
  vec3 d = vec3( cos( el ) * cos( az ), sin( el ), cos( el ) * sin( az ) );
  vec3 s = vec3( sqrt( max( 0.0, 1.0 - uSun.y * uSun.y ) ), uSun.y, 0.0 );
  vec3 o = vec3( 0.0, RG + ${EYE.toFixed(1)}, 0.0 );
  float tg = rayGround( o, d );
  float tmax = tg > 0.0 ? tg : rayExit( o, d, RT );
  float mu = dot( d, s );
  float pr = 3.0 / ( 16.0 * PI ) * ( 1.0 + mu * mu );
  const float g = 0.8;
  float pm = 3.0 / ( 8.0 * PI ) * ( 1.0 - g * g ) * ( 1.0 + mu * mu ) / ( ( 2.0 + g * g ) * pow( 1.0 + g * g - 2.0 * g * mu, 1.5 ) );
  vec3 L = vec3( 0.0 ), T = vec3( 1.0 );
  for ( int i = 0; i < ${VIEW_STEPS}; i ++ ) {
    float a = float( i ) / ${VIEW_STEPS}.0, b = float( i + 1 ) / ${VIEW_STEPS}.0;
    float t0 = tmax * a * a, t1 = tmax * b * b, dt = t1 - t0;
    vec3 p = o + d * ( 0.5 * ( t0 + t1 ) );
    float h = length( p ) - RG;
    vec3 ext = extinction( h );
    vec3 scat = ( BR * exp( -h / 8000.0 ) * pr + BMS * uMie * exp( -h / 1200.0 ) * pm ) * sunTransmittance( p, s );
    vec3 st = exp( -ext * dt );
    L += T * scat * ( 1.0 - st ) / max( ext, vec3( 1e-12 ) );
    T *= st;
  }
  gl_FragColor = vec4( L, 1.0 );
}`;

// GLSL lookup into the table for a world direction (shared with the water).
export const SKY_LUT_GLSL = /* glsl */ `
vec3 btSkyLUT( sampler2D lut, vec3 d, vec3 sun ) {
  float el = asin( clamp( d.y, -1.0, 1.0 ) );
  vec2 a = d.xz, b = sun.xz;
  float la = length( a ), lb = length( b );
  float c = ( la > 1e-4 && lb > 1e-4 ) ? dot( a, b ) / ( la * lb ) : 1.0;
  float u = acos( clamp( c, -1.0, 1.0 ) ) / 3.14159265;
  float v = 0.5 + 0.5 * sign( el ) * sqrt( abs( el ) / 1.5707963 );
  return texture2D( lut, vec2( u, v ) ).rgb;
}
`;

// --- CPU version, for a few directions per update.

function rayExit(ox, oy, oz, dx, dy, dz, r) {
  const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - r * r;
  return -b + Math.sqrt(Math.max(b * b - c, 0));
}
function rayGround(ox, oy, oz, dx, dy, dz) {
  const b = ox * dx + oy * dy + oz * dz, c = ox * ox + oy * oy + oz * oz - RG * RG, disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : -1;
}
function extinction(h, mie, out) {
  const r = Math.exp(-h / 8000), m = BME * mie * Math.exp(-h / 1200), o = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
  out[0] = BR[0] * r + m + BO[0] * o;
  out[1] = BR[1] * r + m + BO[1] * o;
  out[2] = BR[2] * r + m + BO[2] * o;
  return out;
}
const ext = [0, 0, 0];
function sunTransmittanceAt(px, py, pz, s, mie, out) {
  if (rayGround(px, py, pz, s.x, s.y, s.z) > 0) { out[0] = out[1] = out[2] = 0; return out; }
  const tmax = rayExit(px, py, pz, s.x, s.y, s.z, RT);
  let o0 = 0, o1 = 0, o2 = 0;
  for (let i = 0; i < SUN_STEPS; i++) {
    const a = i / SUN_STEPS, b = (i + 1) / SUN_STEPS;
    const t0 = tmax * a * a, t1 = tmax * b * b, tm = 0.5 * (t0 + t1);
    const qx = px + s.x * tm, qy = py + s.y * tm, qz = pz + s.z * tm;
    extinction(Math.hypot(qx, qy, qz) - RG, mie, ext);
    o0 += ext[0] * (t1 - t0); o1 += ext[1] * (t1 - t0); o2 += ext[2] * (t1 - t0);
  }
  out[0] = Math.exp(-o0); out[1] = Math.exp(-o1); out[2] = Math.exp(-o2);
  return out;
}

// Direct sunlight reaching the viewer (0..1 per channel).
export function sunTransmittance(sunDir, mie, out = [0, 0, 0]) {
  return sunTransmittanceAt(0, RG + EYE, 0, sunDir, mie, out);
}

// Sky radiance in world direction d (y up) for the sun in direction s.
const ts = [0, 0, 0];
export function skyRadiance(d, s, mie, out = [0, 0, 0]) {
  const ox = 0, oy = RG + EYE, oz = 0;
  const tg = rayGround(ox, oy, oz, d.x, d.y, d.z);
  const tmax = tg > 0 ? tg : rayExit(ox, oy, oz, d.x, d.y, d.z, RT);
  const mu = d.x * s.x + d.y * s.y + d.z * s.z;
  const pr = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g = 0.8;
  const pm = ((3 / (8 * Math.PI)) * (1 - g * g) * (1 + mu * mu)) / ((2 + g * g) * Math.pow(1 + g * g - 2 * g * mu, 1.5));
  let l0 = 0, l1 = 0, l2 = 0, t0r = 1, t1r = 1, t2r = 1;
  for (let i = 0; i < VIEW_STEPS; i++) {
    const a = i / VIEW_STEPS, b = (i + 1) / VIEW_STEPS;
    const ta = tmax * a * a, tb = tmax * b * b, dt = tb - ta, tm = 0.5 * (ta + tb);
    const px = ox + d.x * tm, py = oy + d.y * tm, pz = oz + d.z * tm;
    const h = Math.hypot(px, py, pz) - RG;
    extinction(h, mie, ext);
    sunTransmittanceAt(px, py, pz, s, mie, ts);
    const dr = Math.exp(-h / 8000) * pr, dm = BMS * mie * Math.exp(-h / 1200) * pm;
    for (let c = 0; c < 3; c++) {
      const e = Math.max(ext[c], 1e-12);
      const st = Math.exp(-e * dt);
      const tr = c === 0 ? t0r : c === 1 ? t1r : t2r;
      const add = tr * (BR[c] * dr + dm) * ts[c] * (1 - st) / e;
      if (c === 0) { l0 += add; t0r *= st; } else if (c === 1) { l1 += add; t1r *= st; } else { l2 += add; t2r *= st; }
    }
  }
  out[0] = l0; out[1] = l1; out[2] = l2;
  return out;
}

// The sky-view table, re-rendered when the sun or the haze changes.
export function createAtmosphere(renderer) {
  const target = new THREE.WebGLRenderTarget(LUT_SIZE.width, LUT_SIZE.height, {
    type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  const material = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: lutFragment,
    uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uMie: { value: 1 } },
    depthTest: false, depthWrite: false,
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let lastY = 2, lastMie = -1;

  return {
    texture: target.texture,
    // Only the sun's elevation matters: the table is stored relative to its azimuth.
    update(sunDir, mie) {
      if (Math.abs(sunDir.y - lastY) < 0.0005 && Math.abs(mie - lastMie) < 0.01) return;
      lastY = sunDir.y;
      lastMie = mie;
      material.uniforms.uSun.value.copy(sunDir);
      material.uniforms.uMie.value = mie;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
    },
  };
}
