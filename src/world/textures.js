import * as THREE from 'three';
import { mulberry32, range } from '../shared.js';

// Procedural textures, made once at startup so the game ships no image
// files. Ground, rock and bark textures are tileable noise drawn on the GPU;
// leaves, needles and grass blades are drawn with canvas 2D.
//
// Baked colour textures store sqrt(albedo) in RGB (cheap gamma that keeps
// dark tones precise in 8 bits); shaders square it back to linear.

const NOISE = /* glsl */ `
#define TAU 6.28318530718
varying vec2 vUv;
uniform vec2 uRes;

vec3 srgb( vec3 c ) { return pow( c, vec3( 2.2 ) ); }

vec2 hash22( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.xx + p3.yz ) * p3.zy );
}
float hash12( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

// Gradient noise that wraps every 'period' lattice cells.
float gnoise( vec2 p, vec2 period, float seed ) {
  vec2 i = floor( p ), f = p - i;
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  vec2 s = vec2( seed * 17.13, seed * 7.31 );
  vec2 g00 = hash22( mod( i, period ) + s ) * 2.0 - 1.0;
  vec2 g10 = hash22( mod( i + vec2( 1.0, 0.0 ), period ) + s ) * 2.0 - 1.0;
  vec2 g01 = hash22( mod( i + vec2( 0.0, 1.0 ), period ) + s ) * 2.0 - 1.0;
  vec2 g11 = hash22( mod( i + vec2( 1.0, 1.0 ), period ) + s ) * 2.0 - 1.0;
  float n00 = dot( g00, f ), n10 = dot( g10, f - vec2( 1.0, 0.0 ) );
  float n01 = dot( g01, f - vec2( 0.0, 1.0 ) ), n11 = dot( g11, f - vec2( 1.0, 1.0 ) );
  return 1.4 * mix( mix( n00, n10, u.x ), mix( n01, n11, u.x ), u.y );
}

// Fractal noise over the unit tile, 'freq' cells per tile on each axis. About -1..1.
float fbm( vec2 uv, vec2 freq, int octaves, float seed ) {
  float sum = 0.0, amp = 0.5, norm = 0.0;
  for ( int i = 0; i < 8; i ++ ) {
    if ( i >= octaves ) break;
    sum += amp * gnoise( uv * freq, freq, seed + float( i ) * 3.1 );
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}
float fbm( vec2 uv, float freq, int octaves, float seed ) { return fbm( uv, vec2( freq ), octaves, seed ); }

// Tileable cellular noise: x = nearest feature distance, y = second nearest, z = cell id.
vec3 voronoi( vec2 uv, vec2 freq, float seed ) {
  vec2 p = uv * freq;
  vec2 i = floor( p ), f = p - i;
  vec2 s = vec2( seed * 13.7, seed * 5.9 );
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 o = vec2( float( x ), float( y ) );
    vec2 c = mod( i + o, freq ) + s;
    vec2 r = o + hash22( c ) - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; id = hash12( c + 3.7 ); }
    else if ( d < d2 ) d2 = d;
  }
  return vec3( sqrt( d1 ), sqrt( d2 ), id );
}
vec3 voronoi( vec2 uv, float freq, float seed ) { return voronoi( uv, vec2( freq ), seed ); }

// Short tapered strokes scattered over the tile (blades, needles, twigs).
// x = coverage, y = the stroke's random tone, z = position along it (0..1).
// len is in cells and must stay under 0.7 so strokes never get clipped.
vec3 strokes( vec2 uv, float freq, float seed, float len, float width, float angle, float spread ) {
  vec2 p = uv * freq;
  vec2 i = floor( p ), f = p - i;
  vec2 s = vec2( seed * 11.3, seed * 3.7 );
  vec3 best = vec3( 0.0 );
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 o = vec2( float( x ), float( y ) );
    vec2 c = mod( i + o, vec2( freq ) ) + s;
    float a = angle + ( hash12( c + 1.3 ) - 0.5 ) * spread;
    vec2 dir = vec2( cos( a ), sin( a ) );
    vec2 r = f - ( o + hash22( c ) );
    float L = len * ( 0.6 + 0.8 * hash12( c + 2.9 ) );
    float t = dot( r, dir ) / L;
    float w = width * ( 1.0 - t * t );
    float cov = ( 1.0 - smoothstep( w * 0.45, w, abs( dot( r, vec2( -dir.y, dir.x ) ) ) ) ) * step( abs( t ), 1.0 );
    if ( cov > best.x ) best = vec3( cov, hash12( c + 7.1 ), t * 0.5 + 0.5 );
  }
  return best;
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

// --- Ground layers. Each writes sqrt(albedo) and a height in alpha.

const SAND = /* glsl */ `
void main() {
  vec2 uv = vUv;
  float warp = fbm( uv, 4.0, 3, 1.0 );
  float ripMask = smoothstep( -0.25, 0.45, fbm( uv, 3.0, 2, 2.0 ) );
  float rip = sin( TAU * ( 13.0 * uv.x + 5.0 * uv.y ) + warp * 5.0 );
  float rip2 = sin( TAU * ( -4.0 * uv.x + 11.0 * uv.y ) + warp * 3.0 );
  float large = fbm( uv, 2.0, 4, 3.0 );
  float fine = fbm( uv, 48.0, 2, 4.0 );
  float grain = hash12( floor( uv * uRes ) );
  float h = 0.5 + 0.2 * rip * ripMask + 0.08 * rip2 * ( 1.0 - ripMask ) + 0.12 * large + 0.06 * fine + 0.03 * grain;

  vec3 c = srgb( vec3( 0.72, 0.64, 0.50 ) );
  c *= 0.9 + 0.14 * large + 0.1 * ( grain - 0.5 ) + 0.06 * fine;
  c = mix( c, srgb( vec3( 0.60, 0.53, 0.41 ) ), smoothstep( 0.3, -0.7, rip ) * ripMask * 0.4 );
  c = mix( c, srgb( vec3( 0.33, 0.30, 0.27 ) ), step( 0.982, hash12( floor( uv * uRes * 0.5 ) + 9.0 ) ) * 0.7 );
  c = mix( c, srgb( vec3( 0.96, 0.93, 0.87 ) ), step( 0.993, hash12( floor( uv * uRes * 0.34 ) + 2.0 ) ) * 0.9 );
  gl_FragColor = vec4( sqrt( c ), clamp( h, 0.0, 1.0 ) );
}`;

const GRASS = /* glsl */ `
void main() {
  vec2 uv = vUv;
  float dryPatch = smoothstep( 0.0, 0.6, fbm( uv, 3.0, 3, 1.0 ) );
  // Dense turf: the gaps show shaded lower blades, not bare soil.
  vec3 col = srgb( vec3( 0.25, 0.30, 0.13 ) ) * ( 0.8 + 0.3 * fbm( uv, 16.0, 2, 2.0 ) );
  float h = 0.15 + 0.1 * fbm( uv, 8.0, 2, 3.0 );
  for ( int L = 0; L < 4; L ++ ) {
    float fl = float( L );
    vec3 s = strokes( uv, 26.0 + fl * 15.0, 10.0 + fl, 0.64, 0.17, fl * 1.7, TAU );
    vec3 g = mix( srgb( vec3( 0.27, 0.38, 0.13 ) ), srgb( vec3( 0.46, 0.56, 0.22 ) ), s.y );
    g = mix( g, srgb( vec3( 0.62, 0.58, 0.33 ) ), dryPatch * 0.5 * s.y * s.z );
    g *= 0.75 + 0.35 * s.z;
    col = mix( col, g, s.x );
    h = mix( h, 0.4 + 0.13 * fl + 0.2 * s.z, s.x );
  }
  vec3 v = voronoi( uv, 16.0, 5.0 );
  float clover = ( 1.0 - smoothstep( 0.1, 0.2, v.x ) ) * step( 0.85, v.z );
  col = mix( col, srgb( vec3( 0.30, 0.50, 0.18 ) ), clover );
  h = max( h, clover * 0.85 );
  gl_FragColor = vec4( sqrt( col ), clamp( h, 0.0, 1.0 ) );
}`;

const FOREST = /* glsl */ `
vec3 litter( float k ) {
  if ( k < 0.3 ) return srgb( vec3( 0.43, 0.29, 0.14 ) );
  if ( k < 0.55 ) return srgb( vec3( 0.30, 0.19, 0.10 ) );
  if ( k < 0.8 ) return srgb( vec3( 0.55, 0.36, 0.15 ) );
  return srgb( vec3( 0.50, 0.44, 0.30 ) );
}
// Fallen leaves: one oriented ellipse per cell, topmost one wins.
vec4 leaves( vec2 uv, float freq, float seed, inout float h ) {
  vec2 p = uv * freq;
  vec2 i = floor( p ), f = p - i;
  vec4 res = vec4( 0.0 );
  float top = -1.0;
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 o = vec2( float( x ), float( y ) );
    vec2 c = mod( i + o, vec2( freq ) ) + seed * 7.7;
    float a = hash12( c + 1.7 ) * TAU;
    vec2 dir = vec2( cos( a ), sin( a ) );
    vec2 r = f - ( o + hash22( c ) );
    float along = dot( r, dir ), across = dot( r, vec2( -dir.y, dir.x ) );
    float size = 0.32 + 0.3 * hash12( c + 4.1 );
    float e = ( along * along + across * across * 4.5 ) / ( size * size );
    float cov = 1.0 - smoothstep( 0.8, 1.0, e );
    float layer = hash12( c + 9.3 );
    if ( cov > 0.01 && layer > top ) {
      top = layer;
      vec3 lc = litter( hash12( c + 5.5 ) ) * ( 0.85 + 0.3 * hash12( c + 6.6 ) );
      lc *= 1.0 - 0.3 * ( 1.0 - smoothstep( 0.0, 0.05, abs( across ) ) );
      res = vec4( lc, cov );
    }
  }
  h = mix( h, 0.45 + 0.3 * top, res.a );
  return res;
}
void main() {
  vec2 uv = vUv;
  vec3 col = srgb( vec3( 0.28, 0.21, 0.14 ) ) * ( 0.7 + 0.45 * fbm( uv, 10.0, 3, 1.0 ) );
  float h = 0.2 + 0.12 * fbm( uv, 6.0, 3, 2.0 );
  vec4 l1 = leaves( uv, 34.0, 1.0, h );
  col = mix( col, l1.rgb, l1.a );
  vec4 l2 = leaves( uv, 52.0, 2.0, h );
  col = mix( col, l2.rgb, l2.a * 0.9 );
  vec3 nd = strokes( uv, 30.0, 4.0, 0.68, 0.05, 0.0, TAU );
  col = mix( col, srgb( vec3( 0.47, 0.31, 0.16 ) ) * ( 0.75 + 0.4 * nd.y ), nd.x * 0.9 );
  h = max( h, nd.x * 0.6 );
  vec3 tw = strokes( uv, 7.0, 6.0, 0.6, 0.035, 0.0, TAU );
  col = mix( col, srgb( vec3( 0.29, 0.21, 0.14 ) ), tw.x );
  h = max( h, tw.x * 0.8 );
  float moss = smoothstep( 0.12, 0.42, fbm( uv, 3.0, 4, 8.0 ) );
  float mossDetail = fbm( uv, 48.0, 2, 9.0 );
  col = mix( col, srgb( vec3( 0.32, 0.44, 0.15 ) ) * ( 0.7 + 0.5 * mossDetail ), moss * 0.85 );
  h = mix( h, 0.5 + 0.12 * mossDetail, moss * 0.8 );
  gl_FragColor = vec4( sqrt( col ), clamp( h, 0.0, 1.0 ) );
}`;

const ROCK = /* glsl */ `
void main() {
  vec2 uv = vUv;
  float n1 = fbm( uv, 3.0, 7, 1.0 );
  float n2 = fbm( uv + n1 * 0.15, 7.0, 6, 2.0 );
  float n3 = fbm( uv, 24.0, 4, 7.0 );
  // A few long, wandering fractures; the rest is weathered, pitted stone.
  vec3 v1 = voronoi( uv + vec2( n1, n2 ) * 0.08, 4.0, 3.0 );
  float crack = 1.0 - smoothstep( 0.0, 0.022, v1.y - v1.x );
  crack *= smoothstep( -0.1, 0.3, fbm( uv, 5.0, 3, 9.0 ) );
  float strata = sin( TAU * ( 2.0 * uv.y + uv.x ) + n1 * 7.0 ) * 0.5 + 0.5;
  float grain = hash12( floor( uv * uRes ) );
  float h = 0.5 + 0.28 * n1 + 0.16 * n2 + 0.07 * n3 - 0.3 * crack + 0.03 * grain;
  vec3 c = mix( srgb( vec3( 0.45, 0.44, 0.42 ) ), srgb( vec3( 0.62, 0.60, 0.56 ) ), smoothstep( -0.5, 0.5, n2 ) );
  c = mix( c, srgb( vec3( 0.55, 0.50, 0.43 ) ), strata * 0.3 * smoothstep( -0.2, 0.4, n1 ) );
  c *= 0.86 + 0.18 * n3 + 0.12 * ( grain - 0.5 );
  c *= 1.0 - 0.45 * crack;
  // Darker streaks where water runs down, pale lichen crusts on the rest.
  c *= 1.0 - 0.18 * smoothstep( 0.2, 0.7, fbm( vec2( uv.x * 3.0, uv.y ), vec2( 12.0, 3.0 ), 3, 4.0 ) );
  float lichen = smoothstep( 0.45, 0.7, fbm( uv, 10.0, 4, 6.0 ) ) * ( 1.0 - crack );
  c = mix( c, srgb( vec3( 0.62, 0.63, 0.50 ) ), lichen * 0.45 );
  gl_FragColor = vec4( sqrt( c ), clamp( h, 0.0, 1.0 ) );
}`;

// Bark: u runs around the trunk, v along it.
const PINE_BARK = /* glsl */ `
void main() {
  vec2 uv = vUv;
  float n = fbm( uv, vec2( 4.0, 8.0 ), 4, 1.0 );
  // Small flaky scales in vertical rows, with irregular dark fissures.
  vec3 v = voronoi( uv + vec2( n * 0.04, n * 0.08 ), vec2( 14.0, 9.0 ), 2.0 );
  float fissure = 1.0 - smoothstep( 0.0, 0.07, v.y - v.x );
  fissure *= 0.6 + 0.4 * smoothstep( -0.3, 0.3, fbm( uv, vec2( 6.0, 4.0 ), 3, 5.0 ) );
  float plate = fbm( uv, vec2( 24.0, 16.0 ), 4, 3.0 );
  float h = 0.62 + 0.18 * plate + 0.08 * ( v.z - 0.5 ) - 0.5 * fissure;
  vec3 c = mix( srgb( vec3( 0.42, 0.32, 0.25 ) ), srgb( vec3( 0.56, 0.44, 0.34 ) ), v.z * 0.7 + 0.3 * smoothstep( -0.4, 0.4, n ) );
  c *= 0.85 + 0.3 * plate;
  c = mix( c, srgb( vec3( 0.20, 0.15, 0.12 ) ), fissure * 0.8 );
  gl_FragColor = vec4( sqrt( c ), clamp( h, 0.0, 1.0 ) );
}`;

const OAK_BARK = /* glsl */ `
void main() {
  vec2 uv = vUv;
  float warp = fbm( uv, vec2( 3.0, 2.0 ), 3, 1.0 );
  float ridges = abs( gnoise( vec2( uv.x * 14.0 + warp * 2.0, uv.y * 3.0 ), vec2( 14.0, 3.0 ), 2.0 ) );
  float grainN = fbm( uv, vec2( 10.0, 20.0 ), 3, 3.0 );
  float h = 0.3 + 0.6 * smoothstep( 0.0, 0.6, ridges ) + 0.12 * grainN;
  vec3 c = mix( srgb( vec3( 0.42, 0.39, 0.35 ) ), srgb( vec3( 0.66, 0.62, 0.56 ) ), smoothstep( 0.05, 0.7, ridges ) );
  c *= 0.85 + 0.3 * grainN;
  float moss = smoothstep( 0.25, 0.6, fbm( uv, vec2( 4.0, 3.0 ), 3, 6.0 ) ) * ( 1.0 - uv.y * 0.5 );
  c = mix( c, srgb( vec3( 0.24, 0.32, 0.12 ) ), moss * 0.5 );
  gl_FragColor = vec4( sqrt( c ), clamp( h, 0.0, 1.0 ) );
}`;

// Normals from the height in alpha. Packed: RG = normal xy, B = roughness,
// A = cavity occlusion; or a standard RGB normal map (A = occlusion).
const NORMALS = /* glsl */ `
uniform sampler2D tSrc;
uniform float uStrength;
uniform float uRough;
uniform float uRoughVar;
uniform float uAO;
uniform bool uStandard;
float H( ivec2 c ) {
  ivec2 s = textureSize( tSrc, 0 );
  return texelFetch( tSrc, ivec2( ( c.x + s.x ) % s.x, ( c.y + s.y ) % s.y ), 0 ).a;
}
void main() {
  ivec2 c = ivec2( gl_FragCoord.xy );
  float h0 = H( c );
  vec3 n = normalize( vec3( ( H( c - ivec2( 1, 0 ) ) - H( c + ivec2( 1, 0 ) ) ) * uStrength,
                            ( H( c - ivec2( 0, 1 ) ) - H( c + ivec2( 0, 1 ) ) ) * uStrength, 1.0 ) );
  float avg = 0.0;
  for ( int k = 0; k < 8; k ++ ) {
    float a = float( k ) * 0.785398;
    avg += H( c + ivec2( round( vec2( cos( a ), sin( a ) ) * 4.0 ) ) );
  }
  float ao = clamp( 1.0 - max( avg / 8.0 - h0, 0.0 ) * uAO, 0.35, 1.0 );
  float rough = clamp( uRough + ( 0.5 - h0 ) * uRoughVar, 0.05, 1.0 );
  gl_FragColor = uStandard ? vec4( n * 0.5 + 0.5, ao ) : vec4( n.xy * 0.5 + 0.5, rough, ao );
}`;

// Cloud and variation noise: R billowy cloud shapes, G cloud detail,
// B very large patches, A medium patches.
const CLOUDS = /* glsl */ `
void main() {
  vec2 uv = vUv;
  float b = fbm( uv, 4.0, 6, 1.0 );
  float w = 1.0 - voronoi( uv + b * 0.05, 6.0, 2.0 ).x;
  float base = clamp( 0.5 + 0.55 * b + 0.45 * ( w - 0.55 ), 0.0, 1.0 );
  float d = fbm( uv, 16.0, 4, 3.0 );
  float dw = 1.0 - voronoi( uv, 24.0, 4.0 ).x;
  float detail = clamp( 0.5 + 0.5 * d + 0.3 * ( dw - 0.55 ), 0.0, 1.0 );
  float macro = clamp( 0.5 + 0.6 * fbm( uv, 2.0, 4, 5.0 ), 0.0, 1.0 );
  float mid = clamp( 0.5 + 0.6 * fbm( uv, 8.0, 4, 6.0 ), 0.0, 1.0 );
  gl_FragColor = vec4( base, detail, macro, mid );
}`;

// Renders full-screen shader passes into textures.
export class TextureBaker {
  constructor(renderer) {
    this.renderer = renderer;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(geometry);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  bake(fragment, size, { uniforms = {}, anisotropy = 1, mipmaps = true, type = THREE.UnsignedByteType } = {}) {
    const target = new THREE.WebGLRenderTarget(size, size, {
      type, depthBuffer: false, generateMipmaps: mipmaps, anisotropy,
      minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    const material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: NOISE + fragment,
      uniforms: { uRes: { value: new THREE.Vector2(size, size) }, ...uniforms },
      depthTest: false, depthWrite: false,
    });
    this.mesh.material = material;
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(prev);
    material.dispose();
    return target.texture;
  }

  // Colour+height texture plus its normal/roughness/occlusion texture.
  // strength is the height relief: metres of height range per metre of texture.
  layer(fragment, size, { strength, rough = 0.9, roughVar = 0.2, ao = 3, standard = false, anisotropy = 1 }) {
    const albedo = this.bake(fragment, size, { anisotropy });
    const normal = this.bake(NORMALS, size, {
      anisotropy,
      uniforms: {
        tSrc: { value: albedo }, uStrength: { value: strength * size / 2 }, uRough: { value: rough },
        uRoughVar: { value: roughVar }, uAO: { value: ao }, uStandard: { value: standard },
      },
    });
    return { albedo, normal };
  }
}

// Ground layers for the terrain, in shader order: sand, grass, forest floor, rock.
// strength = height range / tile size, so relief stays right whatever the resolution.
export function bakeGround(baker, size, anisotropy) {
  return {
    sand: baker.layer(SAND, size, { strength: 0.012 / 3, rough: 0.94, roughVar: 0.1, ao: 2, anisotropy }),
    grass: baker.layer(GRASS, size, { strength: 0.03 / 2.5, rough: 0.92, roughVar: 0.1, ao: 3, anisotropy }),
    forest: baker.layer(FOREST, size, { strength: 0.03 / 3, rough: 0.88, roughVar: 0.2, ao: 3, anisotropy }),
    rock: baker.layer(ROCK, size, { strength: 0.08 / 4, rough: 0.78, roughVar: 0.3, ao: 2.5, anisotropy }),
  };
}

export function bakeBark(baker, size, anisotropy) {
  const s = Math.max(128, size / 2);
  return {
    pine: baker.layer(PINE_BARK, s, { strength: 0.05, standard: true, ao: 2, anisotropy }),
    oak: baker.layer(OAK_BARK, s, { strength: 0.05, standard: true, ao: 2, anisotropy }),
  };
}

export function bakeCloudNoise(baker) {
  return baker.bake(CLOUDS, 512, { anisotropy: 4 });
}

// --- Foliage sprites (canvas 2D). Colour and coverage are drawn separately
// and merged, so transparent texels keep a leaf colour and mipmaps don't
// darken the edges.

function canvasPair(w, h, background) {
  const make = () => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  };
  const color = make(), mask = make();
  const cc = color.getContext('2d'), mc = mask.getContext('2d');
  cc.fillStyle = background;
  cc.fillRect(0, 0, w, h);
  mc.fillStyle = '#000';
  mc.fillRect(0, 0, w, h);
  // Draw a shape on both: the colour canvas gets 'fill', the mask gets white.
  const draw = (shape, fill, stroke = null, lineWidth = 1) => {
    for (const [ctx, isMask] of [[cc, false], [mc, true]]) {
      ctx.beginPath();
      shape(ctx);
      if (stroke) {
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = isMask ? '#fff' : stroke;
        ctx.stroke();
      } else {
        ctx.fillStyle = isMask ? '#fff' : fill;
        ctx.fill();
      }
    }
  };
  return { color, mask, cc, mc, draw };
}

function spriteTexture({ color, mask }, anisotropy) {
  const w = color.width, h = color.height;
  const c = color.getContext('2d').getImageData(0, 0, w, h).data;
  const m = mask.getContext('2d').getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = y * w * 4, dst = (h - 1 - y) * w * 4; // canvas top = texture top (v = 1)
    for (let x = 0; x < w * 4; x += 4) {
      data[dst + x] = c[src + x];
      data[dst + x + 1] = c[src + x + 1];
      data[dst + x + 2] = c[src + x + 2];
      data[dst + x + 3] = m[src + x];
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

const hsl = (h, s, l) => `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%)`;

// A twig of broad leaves filling the card. Leaves point away from the twig base.
export function leafSprite(anisotropy, seed = 3) {
  const rng = mulberry32(seed);
  const S = 512;
  const pair = canvasPair(S, S, hsl(92, 38, 24));
  const { draw } = pair;
  const twigs = [];
  // Main twig from the bottom centre, with side twigs.
  const main = { x0: S * 0.5, y0: S * 0.98, x1: S * 0.5 + range(rng, -40, 40), y1: S * 0.12 };
  twigs.push(main);
  for (let i = 0; i < 7; i++) {
    const t = 0.18 + i * 0.11;
    const x = main.x0 + (main.x1 - main.x0) * t, y = main.y0 + (main.y1 - main.y0) * t;
    const side = i % 2 ? 1 : -1;
    const ang = -Math.PI / 2 + side * range(rng, 0.6, 1.1);
    const len = range(rng, 110, 190) * (1 - t * 0.5);
    twigs.push({ x0: x, y0: y, x1: x + Math.cos(ang) * len, y1: y + Math.sin(ang) * len });
  }
  for (const t of twigs) {
    draw((ctx) => { ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); }, null, hsl(25, 30, 22), 4);
  }
  // Leaves along every twig, alternating sides, smaller towards the tips.
  const leaves = [];
  for (const t of twigs) {
    const dx = t.x1 - t.x0, dy = t.y1 - t.y0, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const count = Math.round(len / 22);
    for (let i = 1; i <= count; i++) {
      const f = i / count;
      const side = i % 2 ? 1 : -1;
      const a = Math.atan2(uy, ux) + side * range(rng, 0.5, 1.1);
      leaves.push({ x: t.x0 + dx * f, y: t.y0 + dy * f, a, size: range(rng, 46, 70) * (1 - f * 0.35), layer: rng() });
    }
    leaves.push({ x: t.x1, y: t.y1, a: Math.atan2(uy, ux), size: range(rng, 44, 60), layer: rng() });
  }
  leaves.sort((p, q) => p.layer - q.layer);
  for (const l of leaves) {
    const L = l.size, W = L * range(rng, 0.38, 0.5);
    const hue = range(rng, 78, 108), sat = range(rng, 32, 55), lig = range(rng, 18, 33);
    const shape = (ctx) => {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(l.a);
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(L * 0.35, -W * 0.75, L, 0);
      ctx.quadraticCurveTo(L * 0.35, W * 0.75, 0, 0);
      ctx.restore();
    };
    draw(shape, hsl(hue, sat, lig));
    // Lighter midrib and a soft highlight on one half.
    pair.cc.save();
    pair.cc.translate(l.x, l.y);
    pair.cc.rotate(l.a);
    pair.cc.beginPath();
    pair.cc.moveTo(0, 0);
    pair.cc.quadraticCurveTo(L * 0.35, -W * 0.75, L, 0);
    pair.cc.closePath();
    pair.cc.fillStyle = hsl(hue, sat, lig + 5);
    pair.cc.fill();
    pair.cc.beginPath();
    pair.cc.moveTo(L * 0.05, 0);
    pair.cc.lineTo(L * 0.92, 0);
    pair.cc.strokeStyle = hsl(hue - 8, sat - 10, lig + 12);
    pair.cc.lineWidth = 1.5;
    pair.cc.stroke();
    pair.cc.restore();
  }
  return spriteTexture(pair, anisotropy);
}

// A conifer spray: a twig running along the card (u) with side twigs, all
// covered in short needles pointing towards the tip.
export function needleSprite(anisotropy, seed = 5) {
  const rng = mulberry32(seed);
  const W = 512, H = 256;
  const pair = canvasPair(W, H, hsl(128, 28, 22));
  const { draw } = pair;
  const mid = H * 0.5;
  const twigs = [{ x0: 4, y0: mid, x1: W - 6, y1: mid + range(rng, -10, 10), w: 4 }];
  // Side twigs on both sides, shorter towards the tip so the spray tapers.
  for (let x = 24; x < W - 40; x += range(rng, 22, 30)) {
    for (const side of [-1, 1]) {
      const f = x / W;
      const len = range(rng, 80, 120) * (1 - f * 0.6);
      const ang = side * range(rng, 0.5, 0.75);
      twigs.push({ x0: x, y0: mid, x1: x + Math.cos(ang) * len, y1: mid + Math.sin(ang) * len, w: 2.5 });
    }
  }
  for (const t of twigs) draw((ctx) => { ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); }, null, hsl(25, 30, 22), t.w);
  // Needles all along every twig, pointing forwards.
  for (const t of twigs) {
    const dx = t.x1 - t.x0, dy = t.y1 - t.y0, len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    for (let s = 0; s < len; s += 3.2) {
      const px = t.x0 + ux * s, py = t.y0 + uy * s;
      for (const side of [-1, 1]) {
        const a = Math.atan2(uy, ux) + side * range(rng, 0.6, 1.05);
        const nl = range(rng, 18, 30) * (1 - 0.35 * (s / len));
        const hue = range(rng, 115, 145), sat = range(rng, 22, 38), lig = range(rng, 15, 30);
        draw((ctx) => { ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl); },
          null, hsl(hue, sat, lig), range(rng, 2.5, 3.6));
      }
    }
  }
  return spriteTexture(pair, anisotropy);
}

// A clump of grass blades rising from the bottom centre.
export function grassSprite(anisotropy, seed = 9) {
  const rng = mulberry32(seed);
  const W = 256, H = 256;
  const pair = canvasPair(W, H, hsl(86, 36, 28));
  const blades = Array.from({ length: 46 }, () => ({
    x: W * 0.5 + range(rng, -70, 70), h: range(rng, 0.4, 0.97) * H, lean: range(rng, -60, 60),
    w: range(rng, 4, 8), hue: range(rng, 76, 100), dry: rng() < 0.18, layer: rng(),
  })).sort((a, b) => a.layer - b.layer);
  for (const b of blades) {
    const tipX = b.x + b.lean, tipY = H - b.h;
    const shape = (ctx) => {
      ctx.moveTo(b.x - b.w, H);
      ctx.quadraticCurveTo(b.x - b.w * 0.6 + b.lean * 0.2, H - b.h * 0.55, tipX, tipY);
      ctx.quadraticCurveTo(b.x + b.w * 0.6 + b.lean * 0.2, H - b.h * 0.55, b.x + b.w, H);
      ctx.closePath();
    };
    const grad = pair.cc.createLinearGradient(0, H, 0, tipY);
    const lig = b.dry ? 42 : range(rng, 30, 40);
    grad.addColorStop(0, hsl(b.hue + 10, 36, 14));
    grad.addColorStop(0.45, hsl(b.hue, 40, lig - 6));
    grad.addColorStop(1, b.dry ? hsl(46, 40, 54) : hsl(b.hue - 8, 44, lig + 6));
    pair.draw(shape, grad);
  }
  return spriteTexture(pair, anisotropy);
}

// A long ruffled kelp blade, base at the bottom.
export function kelpSprite(anisotropy) {
  const rng = mulberry32(13);
  const W = 128, H = 512;
  const pair = canvasPair(W, H, hsl(48, 50, 22));
  const shape = (ctx) => {
    ctx.moveTo(W * 0.5, H);
    for (let y = H; y >= 8; y -= 16) {
      const f = 1 - y / H;
      ctx.lineTo(W * 0.5 - (8 + 44 * Math.sin(Math.PI * Math.min(1, f * 1.25))) - range(rng, 0, 7), y);
    }
    ctx.lineTo(W * 0.5, 2);
    for (let y = 8; y <= H; y += 16) {
      const f = 1 - y / H;
      ctx.lineTo(W * 0.5 + (8 + 44 * Math.sin(Math.PI * Math.min(1, f * 1.25))) + range(rng, 0, 7), y);
    }
    ctx.closePath();
  };
  const grad = pair.cc.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, hsl(42, 55, 16));
  grad.addColorStop(1, hsl(56, 55, 30));
  pair.draw(shape, grad);
  pair.cc.beginPath();
  pair.cc.moveTo(W * 0.5, H);
  pair.cc.lineTo(W * 0.5, 4);
  pair.cc.strokeStyle = hsl(40, 50, 14);
  pair.cc.lineWidth = 3;
  pair.cc.stroke();
  return spriteTexture(pair, anisotropy);
}
