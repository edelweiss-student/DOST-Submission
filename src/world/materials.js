import * as THREE from 'three';
import { uniforms, CLOUD_HEIGHT } from '../shared.js';

// Patches built-in Lambert/Standard/Depth materials with what the world
// needs: wind sway and leaf flutter, snow on upward faces, wet darkening,
// drought browning, coral bleaching, underwater caustics, cloud shadows,
// shadows that fade out at the edge of the shadow map, fog that glows
// towards the sun, dithered level-of-detail fades, and optional terrain
// texture splatting. Works for plain and instanced meshes.

// Cloud cover from the cloud noise texture. Shared with the sky and water,
// so cloud shadows on the ground line up with the clouds overhead.
export const CLOUD_COVERAGE_GLSL = /* glsl */ `
float btCloudCoverage( float n, float cover ) {
  float lo = mix( 0.64, -0.08, cover );
  return smoothstep( lo, lo + 0.1 + 0.4 * cover, n );
}
`;

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform vec2 uWindDir;
uniform float uWave;
uniform vec2 uLodRange;
varying vec3 btWorldPos;
varying vec3 btWorldNormal;
#ifdef BT_LOD
  varying float btLod;
#endif
`;

const VERT_HEAD = COMMON;

// Replaces three's project_vertex so sway happens in world space.
const PROJECT = /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
#ifdef BT_DEPTH
  vec3 wNrm = vec3( 0.0, 1.0, 0.0 );
#else
  vec3 wNrm = objectNormal;
#endif
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
  wNrm = mat3( instanceMatrix ) * wNrm;
  vec3 wBase = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
#else
  vec3 wBase = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
#endif
wPos = modelMatrix * wPos;
btWorldNormal = normalize( mat3( modelMatrix ) * wNrm );
#ifdef BT_SWAY
  float hgt = max( wPos.y - wBase.y, 0.0 );
  float ph = wBase.x * 0.07 + wBase.z * 0.05;
  #ifdef BT_KELP
    float w = 0.35 + uWave * 0.15;
  #else
    float w = uWind;
  #endif
  float gust = sin( uTime * ( 1.3 + w * 2.0 ) + ph ) * 0.6 + sin( uTime * 3.1 + ph * 1.7 ) * 0.4;
  wPos.xz += uWindDir * ( BT_SWAY * hgt * hgt * 0.008 ) * ( w * 0.8 + gust * ( 0.2 + 0.6 * w ) );
#endif
#ifdef BT_FLUTTER
  // Leaves tremble on their own, more in a strong wind.
  float fl = sin( uTime * ( 5.0 + 4.0 * uWind ) + dot( wPos.xyz, vec3( 2.1, 1.7, 2.9 ) ) );
  wPos.xyz += vec3( uWindDir.x, 0.4, uWindDir.y ) * fl * ( 0.015 + 0.06 * uWind ) * BT_FLUTTER;
#endif
#ifdef BT_LOD
  #ifdef BT_FADE_RANGE
    btLod = 1.0 - smoothstep( BT_FADE_RANGE.x, BT_FADE_RANGE.y, distance( wBase.xz, cameraPosition.xz ) );
  #else
    btLod = 1.0 - smoothstep( uLodRange.x, uLodRange.y, distance( wBase.xz, cameraPosition.xz ) );
  #endif
#endif
btWorldPos = wPos.xyz;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

// Shadow lookups use the swayed position too.
const WORLDPOS = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  vec4 worldPosition = wPos;
#endif
`;

const FRAG_HEAD = COMMON + /* glsl */ `
uniform float uWaterLevel;
uniform float uSnow;
uniform float uWet;
uniform float uDry;
uniform float uSunlight;
uniform float uBleach;
uniform vec3 uLightDir;
uniform vec3 uFogColor;
uniform vec3 uFogSunColor;
uniform sampler2D uCloudTex;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
uniform float uCloudShadow;
uniform vec2 uShadowCenter;
uniform float uShadowRange;

float btUpN = 1.0;        // how much the shaded surface faces up (snow)
float btSunShade = 1.0;   // cloud shadows etc. on direct light
float btFarShadow = 1.0;  // stand-in shadow beyond the shadow map
float btAO = 1.0;         // ambient occlusion on sky light

float btDither( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}

${CLOUD_COVERAGE_GLSL}
float btCloudShadowAt( vec3 p ) {
  vec3 L = uLightDir;
  float t = ( ${CLOUD_HEIGHT.toFixed(1)} - p.y ) / max( L.y, 0.1 );
  vec2 q = p.xz + L.xz * t + uCloudOffset;
  float n = texture2D( uCloudTex, q * ( 1.0 / 5200.0 ) ).r;
  return 1.0 - uCloudShadow * btCloudCoverage( n, uCloudCover );
}
float btShadowFade( float s ) {
  float f = smoothstep( uShadowRange * 0.75, uShadowRange, distance( btWorldPos.xz, uShadowCenter ) );
  return mix( s, btFarShadow, f );
}
`;

// Weather on the base colour, after the material's own colour is known.
const COLOR = /* glsl */ `
#include <color_fragment>
#if !defined( BT_TERRAIN ) && !defined( BT_CUSTOM_UP )
  btUpN = normalize( btWorldNormal ).y;
#endif
float btAbove = smoothstep( uWaterLevel + 0.2, uWaterLevel + 1.2, btWorldPos.y );
#ifdef BT_DRY
  float btGreen = clamp( ( diffuseColor.g - max( diffuseColor.r, diffuseColor.b ) ) * 6.0, 0.0, 1.0 );
  vec3 btStraw = vec3( dot( diffuseColor.rgb, vec3( 0.45, 0.45, 0.1 ) ) ) * vec3( 1.5, 1.05, 0.4 );
  diffuseColor.rgb = mix( diffuseColor.rgb, btStraw, uDry * btGreen * btAbove );
#endif
diffuseColor.rgb *= 1.0 - 0.3 * uWet * btAbove;
float btSnow = smoothstep( BT_SNOW_MIN, BT_SNOW_MIN + 0.3, btUpN ) * uSnow * btAbove;
// Drifts: snow lies unevenly, thinner in patches; a little glitter up close.
float btDrift = texture2D( uCloudTex, btWorldPos.xz * 0.013 ).a;
btSnow *= smoothstep( 0.0, 0.35, uSnow * 1.3 - ( 1.0 - btDrift ) * 0.45 );
float btGlint = step( 0.985, fract( sin( dot( floor( btWorldPos * 40.0 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ) );
vec3 btSnowCol = vec3( 0.84, 0.88, 0.94 ) * ( 0.92 + 0.12 * btDrift ) + btGlint * 0.6 * ( 1.0 - smoothstep( 4.0, 15.0, distance( btWorldPos, cameraPosition ) ) );
diffuseColor.rgb = mix( diffuseColor.rgb, btSnowCol, btSnow );
#ifdef BT_BLEACH
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.9, 0.88, 0.84 ), uBleach * 0.85 );
#endif
#ifdef BT_CAUSTICS
  vec2 cp = btWorldPos.xz * 0.35;
  float cz = sin( cp.x + uTime * 1.1 ) * sin( cp.y * 1.3 - uTime * 0.9 ) + sin( ( cp.x + cp.y ) * 0.7 + uTime * 1.4 ) * 0.5;
  cz = pow( clamp( cz * 0.5 + 0.5, 0.0, 1.0 ), 6.0 );
  float depthFade = clamp( 1.0 + ( btWorldPos.y - uWaterLevel ) / 22.0, 0.0, 1.0 );
  diffuseColor.rgb += cz * 0.3 * ( 1.0 - btAbove ) * depthFade * uSunlight;
#endif
`;

const ALPHA = /* glsl */ `
#include <alphatest_fragment>
#ifdef BT_LOD
  if ( btDither( gl_FragCoord.xy ) >= btLod ) discard;
#endif
`;

const ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
#ifdef BT_TERRAIN
  roughnessFactor = btRough;
#endif
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.45, uWet * btAbove );
roughnessFactor = mix( roughnessFactor, 0.85, btSnow );
`;

const PRELIGHT = /* glsl */ `
#ifdef BT_CLOUD_SHADOWS
  btSunShade *= btCloudShadowAt( btWorldPos );
#endif
#ifndef USE_SHADOWMAP
  btSunShade *= btFarShadow;
#endif
`;

const LIGHTS = THREE.ShaderChunk.lights_fragment_begin
  .replace('getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= btSunShade;')
  .replace(
    /\? getShadow\( directionalShadowMap\[ i \]([^;]*?)\) : 1\.0;/,
    '? btShadowFade( getShadow( directionalShadowMap[ i ]$1) ) : 1.0;',
  );

// Light coming through leaves from behind, plus sky occlusion.
const POSTLIGHT = /* glsl */ `
#if defined( BT_FOLIAGE ) && NUM_DIR_LIGHTS > 0
{
  vec3 L = directLight.direction;
  float back = clamp( dot( -geometryViewDir, L ), 0.0, 1.0 );
  float far = clamp( dot( -geometryNormal, L ) * 0.5 + 0.5, 0.0, 1.0 );
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( diffuseColor.rgb ) * ( pow( back, 4.0 ) * 1.6 + 0.35 ) * far * BT_FOLIAGE;
}
#endif
#if defined( RE_IndirectDiffuse )
  irradiance *= btAO;
#endif
#include <lights_fragment_end>
`;

// Exponential-squared fog by true distance, warmer and brighter towards the sun.
// Applied before tone mapping so it matches the sky at the horizon.
const FOG = /* glsl */ `
#include <opaque_fragment>
#if defined( USE_FOG ) && defined( FOG_EXP2 )
{
  vec3 fv = btWorldPos - cameraPosition;
  float fd = length( fv );
  float fogF = 1.0 - exp( - fogDensity * fogDensity * fd * fd );
  float toLight = pow( max( dot( fv / max( fd, 1e-3 ), uLightDir ), 0.0 ), 6.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uFogColor, uFogSunColor, toLight ), fogF );
}
#endif
`;

const SQRT_MAP = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  sampledDiffuseColor.rgb *= sampledDiffuseColor.rgb;
  diffuseColor *= sampledDiffuseColor;
#endif
`;

// Alpha-tested leaves thin out and vanish in smaller mipmaps, because
// averaging lowers their alpha. Boost alpha by the mip level being read.
const ALPHA_MIP = /* glsl */ `
#if defined( BT_ALPHA_MIP ) && defined( USE_MAP )
{
  vec2 ts = vMapUv * BT_ALPHA_MIP;
  vec2 dx = dFdx( ts ), dy = dFdy( ts );
  float lod = 0.5 * log2( max( max( dot( dx, dx ), dot( dy, dy ) ), 1.0 ) );
  diffuseColor.a *= 1.0 + lod * 0.3;
}
#endif
`;
const alphaMipDefine = (size) => `vec2( ${size[0].toFixed(1)}, ${size[1].toFixed(1)} )`;

// Terrain: four ground layers picked by height, slope and the forest map,
// blended by texture height so grass grows between stones instead of
// cross-fading. Gradients are taken once so branches can skip layers.
const TERRAIN_HEAD = /* glsl */ `
uniform sampler2D tSandA;
uniform sampler2D tSandN;
uniform sampler2D tGrassA;
uniform sampler2D tGrassN;
uniform sampler2D tForestA;
uniform sampler2D tForestN;
uniform sampler2D tRockA;
uniform sampler2D tRockN;
uniform sampler2D uControl;
uniform vec3 uControlRect;   // x0, z0, 1 / size
uniform vec4 uLayerScale;    // texture repeats per metre: sand, grass, forest, rock
vec3 btTN;                   // detailed world normal
float btRough = 0.9;
`;

const TERRAIN_MAP = /* glsl */ `
{
  vec3 n0 = normalize( btWorldNormal );
  vec2 wp = btWorldPos.xz;
  float dist = distance( btWorldPos, cameraPosition );
  vec2 dwx = dFdx( wp ), dwy = dFdy( wp );
  vec4 ctrl = texture2D( uControl, ( wp - uControlRect.xy ) * uControlRect.z );
  vec4 macro = texture2D( uCloudTex, wp * ( 1.0 / 900.0 ) );
  float nMid = macro.a - 0.5, nBig = macro.b - 0.5;
  float h = btWorldPos.y;
  float slope = 1.0 - n0.y;

  float sand = 1.0 - smoothstep( 2.0, 2.8, h + nMid * 1.2 );
  float rock = smoothstep( 0.19, 0.31, slope + nMid * 0.1 );
  rock = max( rock, smoothstep( 38.0, 45.0, h + nBig * 10.0 ) * smoothstep( 0.04, 0.12, slope + nMid * 0.1 ) );
  float land = ( 1.0 - sand ) * ( 1.0 - rock );
  vec4 w = vec4( sand * ( 1.0 - rock ), land * ( 1.0 - ctrl.r ), land * ctrl.r, rock );

  vec4 sc = uLayerScale;
  vec4 a0 = vec4( 0.0 ), a1 = vec4( 0.0 ), a2 = vec4( 0.0 ), a3 = vec4( 0.0 );
  if ( w.x > 0.002 ) a0 = textureGrad( tSandA, wp * sc.x, dwx * sc.x, dwy * sc.x );
  if ( w.y > 0.002 ) a1 = textureGrad( tGrassA, wp * sc.y, dwx * sc.y, dwy * sc.y );
  if ( w.z > 0.002 ) a2 = textureGrad( tForestA, wp * sc.z, dwx * sc.z, dwy * sc.z );
  if ( w.w > 0.002 ) a3 = textureGrad( tRockA, wp * sc.w, dwx * sc.w, dwy * sc.w );
  vec4 hb = vec4( a0.a, a1.a, a2.a, a3.a ) * 0.6 + w;
  float top = max( max( hb.x, hb.y ), max( hb.z, hb.w ) ) - 0.2;
  vec4 b = max( hb - top, 0.0 ) * step( 0.002, w );
  b /= max( dot( b, vec4( 1.0 ) ), 1e-4 );

  // Farther away, mix in a larger, rotated copy of each texture to hide tiling.
  float farMix = smoothstep( 18.0, 70.0, dist ) * 0.55;
  #ifdef BT_FAST_TERRAIN
    farMix = 0.0;
  #endif
  if ( farMix > 0.0 ) {
    mat2 rot = mat2( 0.8, 0.6, -0.6, 0.8 );
    vec2 fp = rot * wp * 0.23 + 0.37;
    vec2 fdx = rot * dwx * 0.23, fdy = rot * dwy * 0.23;
    if ( b.x > 0.05 ) a0.rgb = mix( a0.rgb, textureGrad( tSandA, fp * sc.x, fdx * sc.x, fdy * sc.x ).rgb, farMix );
    if ( b.y > 0.05 ) a1.rgb = mix( a1.rgb, textureGrad( tGrassA, fp * sc.y, fdx * sc.y, fdy * sc.y ).rgb, farMix );
    if ( b.z > 0.05 ) a2.rgb = mix( a2.rgb, textureGrad( tForestA, fp * sc.z, fdx * sc.z, fdy * sc.z ).rgb, farMix );
    if ( b.w > 0.05 ) a3.rgb = mix( a3.rgb, textureGrad( tRockA, fp * sc.w, fdx * sc.w, fdy * sc.w ).rgb, farMix );
  }
  vec3 alb = a0.rgb * a0.rgb * b.x + a1.rgb * a1.rgb * b.y + a2.rgb * a2.rgb * b.z + a3.rgb * a3.rgb * b.w;

  // Detail normals, roughness and cavities. Far away they can't be seen,
  // so those pixels skip the reads and use flat averages.
  vec4 nn = vec4( 0.5, 0.5, 0.9, 0.8 );
  float detail = 1.0 - smoothstep( 40.0, 120.0, dist );
  if ( detail > 0.0 ) {
    nn = vec4( 0.0 );
    nn += b.x > 0.0 ? textureGrad( tSandN, wp * sc.x, dwx * sc.x, dwy * sc.x ) * b.x : vec4( 0.0 );
    nn += b.y > 0.0 ? textureGrad( tGrassN, wp * sc.y, dwx * sc.y, dwy * sc.y ) * b.y : vec4( 0.0 );
    nn += b.z > 0.0 ? textureGrad( tForestN, wp * sc.z, dwx * sc.z, dwy * sc.z ) * b.z : vec4( 0.0 );
    nn += b.w > 0.0 ? textureGrad( tRockN, wp * sc.w, dwx * sc.w, dwy * sc.w ) * b.w : vec4( 0.0 );
    nn = mix( vec4( 0.5, 0.5, nn.z, 0.8 ), nn, detail );
  }
  vec2 dn = nn.xy * 2.0 - 1.0;
  btRough = nn.z;
  alb *= mix( 1.0, nn.w, 0.8 );

  // Large-scale variation: lusher and drier patches, darker damp hollows.
  alb *= 0.84 + 0.32 * macro.a;
  alb = mix( alb, alb * vec3( 1.12, 1.04, 0.72 ), clamp( nBig * 1.6, 0.0, 1.0 ) * ( b.y + b.z * 0.5 ) );
  // Sand the waves keep wet; the seabed darkens and cools with depth.
  float shoreWet = 1.0 - smoothstep( uWaterLevel + 0.1, uWaterLevel + 1.0, h );
  alb *= mix( 1.0, 0.6, shoreWet * b.x );
  btRough = mix( btRough, 0.3, shoreWet * b.x * step( uWaterLevel - 0.3, h ) );
  alb *= mix( vec3( 1.0 ), vec3( 0.62, 0.7, 0.7 ), smoothstep( -1.0, -22.0, h ) );

  // Ground under trees: darker in the open sky light, and in place of the
  // shadow map beyond its range.
  btAO = 1.0 - 0.6 * ctrl.g;
  btFarShadow = 1.0 - 0.75 * ctrl.g;

  btTN = normalize( vec3( n0.x + dn.x, n0.y, n0.z + dn.y ) );
  btUpN = btTN.y;
  diffuseColor.rgb *= alb;
}
`;

const TERRAIN_NORMAL = /* glsl */ `
normal = normalize( ( viewMatrix * vec4( btTN, 0.0 ) ).xyz );
`;

// Three's PCF takes 17 shadow map reads per pixel. This replaces it with one
// bilinear 2x2 lookup (4 reads), or four of them for softer edges.
export function installShadowFilter(taps) {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const start = chunk.indexOf('#if defined( SHADOWMAP_TYPE_PCF )');
  const end = chunk.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )', start);
  const fn = chunk.indexOf('float getShadow(');
  if (start < 0 || end < 0 || fn < 0) return;
  const bilinear = /* glsl */ `
	float btShadowBilinear( sampler2D map, vec2 size, vec2 uv, float z ) {
		vec2 st = uv * size - 0.5;
		vec2 f = fract( st );
		vec2 base = ( floor( st ) + 0.5 ) / size;
		vec2 tx = 1.0 / size;
		float a = texture2DCompare( map, base, z );
		float b = texture2DCompare( map, base + vec2( tx.x, 0.0 ), z );
		float c = texture2DCompare( map, base + vec2( 0.0, tx.y ), z );
		float d = texture2DCompare( map, base + tx, z );
		return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
	}
`;
  const pcf = taps > 1 ? /* glsl */ `#if defined( SHADOWMAP_TYPE_PCF ) && defined( BT_HARD_SHADOW )
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#elif defined( SHADOWMAP_TYPE_PCF )
			vec2 o = 0.75 / shadowMapSize;
			shadow = 0.25 * (
				btShadowBilinear( shadowMap, shadowMapSize, shadowCoord.xy + vec2( -o.x, -o.y ), shadowCoord.z ) +
				btShadowBilinear( shadowMap, shadowMapSize, shadowCoord.xy + vec2( o.x, -o.y ), shadowCoord.z ) +
				btShadowBilinear( shadowMap, shadowMapSize, shadowCoord.xy + vec2( -o.x, o.y ), shadowCoord.z ) +
				btShadowBilinear( shadowMap, shadowMapSize, shadowCoord.xy + vec2( o.x, o.y ), shadowCoord.z ) );
		` : /* glsl */ `#if defined( SHADOWMAP_TYPE_PCF ) && defined( BT_HARD_SHADOW )
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#elif defined( SHADOWMAP_TYPE_PCF )
			shadow = btShadowBilinear( shadowMap, shadowMapSize, shadowCoord.xy, shadowCoord.z );
		`;
  THREE.ShaderChunk.shadowmap_pars_fragment =
    chunk.slice(0, fn) + bilinear + chunk.slice(fn, start) + pcf + chunk.slice(end);
}

const NORMAL_BEGIN_FOLIAGE = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');

// options:
//   key            program cache key (one per distinct option set)
//   sway, kelp     wind sway (height-squared bend), kelp follows the waves instead
//   flutter        leaf trembling amplitude
//   foliage        translucency strength; also keeps leaf normals un-flipped on back faces
//   lod            near mesh that dithers out over uniforms.uLodRange
//   fadeOut        [start, end] metres: dithers out with distance (small props)
//   dry, snowMin, caustics, bleach   weather reactions
//   terrain        { textures, control, controlRect, scales } texture splatting
//   sqrtMap        material.map stores sqrt(albedo)
//   cloudShadows   cloud shadows on direct light
//   custom         { uniforms, vertexHead, beginNormal, begin, fragmentHead, map, color, normal, normalMaps }
//                  shader code replacing or extending the matching three.js chunks
export function patchMaterial(material, {
  key, sway = 0, kelp = false, flutter = 0, foliage = 0, lod = false, dry = false, snowMin = 0.5,
  caustics = false, bleach = false, terrain = null, sqrtMap = false, cloudShadows = false, hardShadow = false,
  fadeOut = null, custom = null,
} = {}) {
  const d = { ...(material.defines || {}), BT_SNOW_MIN: snowMin.toFixed(3) };
  // One shadow-map read instead of four: leaves and grass are busy enough
  // that soft shadow edges don't show.
  if (hardShadow) d.BT_HARD_SHADOW = '';
  if (material.alphaTest > 0 && material.map?.image) d.BT_ALPHA_MIP = alphaMipDefine([material.map.image.width, material.map.image.height]);
  if (bleach) d.BT_BLEACH = '';
  if (sway) d.BT_SWAY = sway.toFixed(3);
  if (kelp) d.BT_KELP = '';
  if (flutter) d.BT_FLUTTER = flutter.toFixed(3);
  if (foliage) d.BT_FOLIAGE = foliage.toFixed(3);
  if (lod) d.BT_LOD = '';
  // Dither out between fadeOut[0] and fadeOut[1] metres from the camera.
  if (fadeOut) {
    d.BT_LOD = '';
    d.BT_FADE_RANGE = `vec2( ${fadeOut[0].toFixed(1)}, ${fadeOut[1].toFixed(1)} )`;
  }
  if (dry) d.BT_DRY = '';
  if (caustics) d.BT_CAUSTICS = '';
  if (terrain) d.BT_TERRAIN = '';
  if (cloudShadows) d.BT_CLOUD_SHADOWS = '';
  material.defines = d;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (terrain) Object.assign(shader.uniforms, terrain.uniforms);
    if (custom?.uniforms) Object.assign(shader.uniforms, custom.uniforms);

    let vs = VERT_HEAD + (custom?.vertexHead || '') + shader.vertexShader;
    if (custom?.beginNormal) vs = vs.replace('#include <beginnormal_vertex>', custom.beginNormal);
    if (custom?.begin) vs = vs.replace('#include <begin_vertex>', custom.begin);
    vs = vs.replace('#include <project_vertex>', PROJECT).replace('#include <worldpos_vertex>', WORLDPOS);
    shader.vertexShader = vs;

    let fs = FRAG_HEAD + (terrain ? TERRAIN_HEAD : '') + (custom?.fragmentHead || '') + shader.fragmentShader;
    if (terrain) fs = fs.replace('#include <map_fragment>', TERRAIN_MAP);
    else if (custom?.map) fs = fs.replace('#include <map_fragment>', custom.map);
    else if (sqrtMap) fs = fs.replace('#include <map_fragment>', SQRT_MAP + ALPHA_MIP);
    else fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n' + ALPHA_MIP);
    fs = fs.replace('#include <color_fragment>', (custom?.color || '') + COLOR)
      .replace('#include <alphatest_fragment>', ALPHA)
      .replace('#include <roughnessmap_fragment>', ROUGHNESS);
    if (custom?.normal) fs = fs.replace('#include <normal_fragment_begin>', custom.normal);
    else if (foliage) fs = fs.replace('#include <normal_fragment_begin>', NORMAL_BEGIN_FOLIAGE);
    if (terrain) fs = fs.replace('#include <normal_fragment_maps>', TERRAIN_NORMAL);
    else if (custom?.normalMaps) fs = fs.replace('#include <normal_fragment_maps>', custom.normalMaps);
    fs = fs.replace('#include <lights_fragment_begin>', PRELIGHT + LIGHTS)
      .replace('#include <lights_fragment_end>', POSTLIGHT)
      .replace('#include <opaque_fragment>', FOG)
      .replace('#include <fog_fragment>', '');
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => 'bt-' + key;
  return material;
}

// Shadow-pass material for alpha-tested, swaying foliage on instanced meshes.
export function foliageDepthMaterial({ key, map, alphaTest = 0.5, sway = 0, flutter = 0 }) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, ...(map ? { map, alphaTest } : {}) });
  m.defines = { BT_DEPTH: '' };
  if (sway) m.defines.BT_SWAY = sway.toFixed(3);
  if (flutter) m.defines.BT_FLUTTER = flutter.toFixed(3);
  if (map?.image) m.defines.BT_ALPHA_MIP = alphaMipDefine([map.image.width, map.image.height]);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <project_vertex>', PROJECT);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + ALPHA_MIP);
  };
  m.customProgramCacheKey = () => 'btd-' + key;
  return m;
}

// Terrain splat uniforms from the baked ground layers.
export function terrainSplat(ground, control, controlRect, scales) {
  return {
    uniforms: {
      tSandA: { value: ground.sand.albedo }, tSandN: { value: ground.sand.normal },
      tGrassA: { value: ground.grass.albedo }, tGrassN: { value: ground.grass.normal },
      tForestA: { value: ground.forest.albedo }, tForestN: { value: ground.forest.normal },
      tRockA: { value: ground.rock.albedo }, tRockN: { value: ground.rock.normal },
      uControl: { value: control },
      uControlRect: { value: controlRect },
      uLayerScale: { value: scales },
    },
  };
}
