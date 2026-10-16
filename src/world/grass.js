import * as THREE from 'three';
import { mulberry32 } from '../shared.js';
import { patchMaterial } from './materials.js';
import { grassSprite } from './textures.js';

// Grass clumps on a fixed world grid around the player. The grid wraps as
// the player moves, so the CPU never touches it: the GPU finds the ground
// height, reads where grass grows from the biome map, bends the blades in
// the wind and around the player, and shrinks clumps away at the edge.

const VERTEX_HEAD = /* glsl */ `
attribute vec4 aOffset;      // grid position 0..1, keep threshold, random
uniform sampler2D uHeightMap;
uniform vec4 uHeightInfo;    // x0, z0, cell size, samples per side
uniform sampler2D uControl;
uniform vec3 uControlRect;
uniform vec2 uPatch;         // patch size, fade radius
uniform float uWaterLevel;
uniform float uSnow;
uniform vec3 uPlayerPos;
uniform sampler2D uCloudTex;
varying vec3 vGrassTint;
varying float vGrassCanopy;

// Same triangle interpolation as terrain.heightAt().
float groundHeight( vec2 p ) {
  float n = uHeightInfo.w - 1.0;
  vec2 g = clamp( ( p - uHeightInfo.xy ) / uHeightInfo.z, vec2( 0.0 ), vec2( n - 1e-3 ) );
  ivec2 i = ivec2( floor( g ) );
  vec2 f = g - vec2( i );
  float h00 = texelFetch( uHeightMap, i, 0 ).r;
  float h10 = texelFetch( uHeightMap, i + ivec2( 1, 0 ), 0 ).r;
  float h01 = texelFetch( uHeightMap, i + ivec2( 0, 1 ), 0 ).r;
  float h11 = texelFetch( uHeightMap, i + ivec2( 1, 1 ), 0 ).r;
  return f.x + f.y <= 1.0 ? h00 + ( h10 - h00 ) * f.x + ( h01 - h00 ) * f.y
                          : h11 + ( h01 - h11 ) * ( 1.0 - f.x ) + ( h10 - h11 ) * ( 1.0 - f.y );
}
`;

const BEGIN_NORMAL = /* glsl */ `
vec2 camXZ = cameraPosition.xz;
float S = uPatch.x;
vec2 rel = mod( aOffset.xy * S - camXZ + 0.5 * S, S ) - 0.5 * S;
vec2 gp = camXZ + rel;
float gh = groundHeight( gp );
vec4 ctrl = textureLod( uControl, ( gp - uControlRect.xy ) * uControlRect.z, 0.0 );
float dist = length( rel );
// Towards the edge clumps thin out and shrink, so there is no hard ring.
float thin = 1.0 - smoothstep( uPatch.y * 0.5, uPatch.y, dist );
float keep = step( aOffset.z, ctrl.b * ( 0.35 + 0.65 * thin ) ) * step( uWaterLevel + 0.35, gh );
float fade = 1.0 - smoothstep( uPatch.y * 0.4, uPatch.y, dist );
vGrassCanopy = ctrl.g;
float size = keep * fade * ( 0.65 + 0.6 * fract( aOffset.w * 7.3 ) ) * ( 1.0 - 0.85 * uSnow );
size *= 0.7 + 0.5 * ctrl.b;
float ang = aOffset.w * 31.4159;
float cs = cos( ang ), sn = sin( ang );
vec3 lp = position;
lp.xz = vec2( cs * lp.x - sn * lp.z, sn * lp.x + cs * lp.z );
float k = lp.y * lp.y;
// Wind gusts roll across the field as waves; blades also lean away from the player.
float wave = sin( dot( gp, uWindDir ) * 0.35 - uTime * ( 1.6 + 2.2 * uWind ) ) * 0.5 + 0.5;
vec2 bend = uWindDir * ( 0.08 + 0.55 * uWind ) * ( 0.35 + 0.65 * wave )
  + 0.05 * vec2( sin( uTime * 2.3 + gp.x * 1.7 ), cos( uTime * 1.9 + gp.y * 1.3 ) );
vec2 away = gp - uPlayerPos.xz;
float pd = length( away );
bend += away / max( pd, 1e-3 ) * smoothstep( 1.2, 0.2, pd ) * step( abs( uPlayerPos.y - gh ), 1.6 ) * 0.9;
vec3 grassPos = vec3( gp.x, gh - 0.05, gp.y ) + lp * size;
grassPos.xz += bend * k * size;
grassPos.y -= dot( bend, bend ) * k * 0.3 * size;
vec3 objectNormal = normalize( vec3( bend.x * 0.3, 1.0, bend.y * 0.3 ) );
// Follow the terrain's large-scale colour variation so near grass matches the ground beyond.
vec4 macro = textureLod( uCloudTex, gp * ( 1.0 / 900.0 ), 0.0 );
vGrassTint = vec3( 0.84 + 0.32 * macro.a ) * mix( vec3( 1.0 ), vec3( 1.12, 1.04, 0.72 ), clamp( ( macro.b - 0.5 ) * 1.6, 0.0, 1.0 ) );
vGrassTint *= 0.85 + 0.3 * fract( aOffset.w * 13.7 );
`;

const BEGIN = /* glsl */ `
vec3 transformed = grassPos;
`;

export function createGrass(scene, terrain, { radius, spacing, anisotropy, msaa, cloudShadows }) {
  if (!radius) return { mesh: null, update() {} };
  const rng = mulberry32(77);
  const S = radius * 2;
  const n = Math.ceil(S / spacing);
  const count = n * n;
  const offsets = new Float32Array(count * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (i + j * n) * 4;
      offsets[o] = (i + rng()) / n;
      offsets[o + 1] = (j + rng()) / n;
      offsets[o + 2] = rng();
      offsets[o + 3] = rng();
    }
  }

  // One clump: three crossing cards, two segments tall so they can bend.
  // The blades fan out from a narrow base, so the cards are trimmed to a
  // wedge: less empty card area for the GPU to shade and throw away.
  const pos = [], uv = [], idx = [];
  const W = 0.7, H = 0.55;
  const widths = [0.62, 0.86, 1];
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI;
    const first = pos.length / 3;
    for (let r = 0; r <= 2; r++) {
      const v = r / 2, w = widths[r];
      const dx = Math.cos(a) * W * 0.5 * w, dz = Math.sin(a) * W * 0.5 * w;
      pos.push(-dx, v * H, -dz, dx, v * H, dz);
      uv.push(0.5 - w / 2, v, 0.5 + w / 2, v);
    }
    for (let r = 0; r < 2; r++) {
      const a0 = first + r * 2;
      idx.push(a0, a0 + 1, a0 + 3, a0, a0 + 3, a0 + 2);
    }
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 4));
  geometry.instanceCount = count;

  const grid = terrain.grid;
  const material = patchMaterial(
    new THREE.MeshLambertMaterial({ map: grassSprite(anisotropy), alphaTest: 0.5, side: THREE.DoubleSide, alphaToCoverage: msaa }),
    {
      key: 'grass', foliage: 0.6, dry: true, snowMin: 0.4, cloudShadows,
      custom: {
        uniforms: {
          uHeightMap: { value: terrain.heightTexture },
          uHeightInfo: { value: new THREE.Vector4(-grid.half, -grid.half, grid.step, grid.size) },
          uControl: { value: terrain.controlTexture },
          uControlRect: { value: terrain.controlRect },
          uPatch: { value: new THREE.Vector2(S, radius) },
        },
        vertexHead: VERTEX_HEAD, beginNormal: BEGIN_NORMAL, begin: BEGIN,
        fragmentHead: 'varying vec3 vGrassTint;\nvarying float vGrassCanopy;\n',
        // Same shade under the trees as the ground around it.
        color: 'diffuseColor.rgb *= vGrassTint;\nbtAO = 1.0 - 0.6 * vGrassCanopy;\nbtFarShadow = 1.0 - 0.75 * vGrassCanopy;\n',
      },
    },
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Keep clumps ordered nearest first (around where they wrap to), so blades
  // hidden behind nearer blades fail the depth test before being shaded.
  // Re-sorted after every couple of metres of movement.
  const attr = geometry.attributes.aOffset;
  const base = offsets.slice();
  const order = new Uint32Array(count), dist = new Float32Array(count);
  let lastX = 1e9, lastZ = 1e9;
  function update(camera) {
    const cx = camera.position.x, cz = camera.position.z;
    if ((cx - lastX) ** 2 + (cz - lastZ) ** 2 < 4) return;
    lastX = cx; lastZ = cz;
    for (let i = 0; i < count; i++) {
      const rx = ((((base[i * 4] * S - cx + 0.5 * S) % S) + S) % S) - 0.5 * S;
      const rz = ((((base[i * 4 + 1] * S - cz + 0.5 * S) % S) + S) % S) - 0.5 * S;
      dist[i] = rx * rx + rz * rz;
      order[i] = i;
    }
    order.sort((a, b) => dist[a] - dist[b]);
    for (let i = 0; i < count; i++) offsets.set(base.subarray(order[i] * 4, order[i] * 4 + 4), i * 4);
    attr.needsUpdate = true;
  }
  return { mesh, count, update };
}
