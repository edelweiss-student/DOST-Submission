import { SKY_GLSL } from './sky.js';
import { CLOUD_HEIGHT } from '../shared.js';

// Water surface shaders. NUM_WAVES and DETAIL_SAMPLES come from material
// defines, chosen by the quality tier. The wave maths must match waves.js.

const shared = /* glsl */ `
#define PI2 6.2831853
uniform float uTime;
uniform vec4 uWaveA[ NUM_WAVES ];  // dirX, dirZ, k, amplitude
uniform vec4 uWaveB[ NUM_WAVES ];  // omega, steepness, phase, grouped (1 wind sea, 0 swell)
uniform vec4 uEnvA;                // wave-group pattern: kx, kz, omega, phase
uniform vec4 uEnvB;
uniform float uGroupStrength;
uniform vec4 uRogue;               // rogue set centre x, centre z, strength
uniform vec2 uRogueDir;
uniform vec3 uCamPos;
uniform float uBreakDepth;
varying vec3 vWorld;
varying vec2 vBase;
varying float vDepth;
varying float vCrest;

// Waves grow as they feel the bottom, then break and die at the shore.
// Mirrors shoalFactor() in waves.js.
float shoalFactor( float depth ) {
  float grow = 1.0 + 0.3 * ( 1.0 - smoothstep( 1.5 * uBreakDepth, 4.0 * uBreakDepth, depth ) );
  return grow * smoothstep( 0.0, uBreakDepth, depth );
}

// How much taller than normal the wind sea is here: travelling sets and
// lulls, plus any rogue set. Mirrors Waves.groupGain() in waves.js.
float waveGroups( vec2 p ) {
  float e = sin( dot( uEnvA.xy, p ) - uEnvA.z * uTime + uEnvA.w ) + sin( dot( uEnvB.xy, p ) - uEnvB.z * uTime + uEnvB.w );
  float gain = max( 1.0 + uGroupStrength * 0.5 * e, 0.15 );
  vec2 o = p - uRogue.xy;
  float along = dot( o, uRogueDir ), across = o.x * uRogueDir.y - o.y * uRogueDir.x;
  gain *= 1.0 + uRogue.z * exp( -along * along / 16200.0 - across * across / 51200.0 );
  return min( gain, 2.2 );
}
`;

export const waterVertex = shared + /* glsl */ `
uniform float uSeaLevel;
uniform sampler2D uHeightMap;
uniform vec3 uHeightRect;           // x0, z0, 1 / size
#include <fog_pars_vertex>

void main() {
  vec3 p = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  vec2 base = p.xz;
  float ground = texture2D( uHeightMap, ( base - uHeightRect.xy ) * uHeightRect.z ).r;
  float depth = uSeaLevel - ground;
  float shoal = shoalFactor( depth );
  float dist = length( base - uCamPos.xz );

  float gain = waveGroups( base );
  vec3 disp = vec3( 0.0 );
  for ( int i = 0; i < NUM_WAVES; i ++ ) {
    vec4 a = uWaveA[ i ];
    vec4 b = uWaveB[ i ];
    float len = PI2 / a.z;
    // Coarse far-away vertices can't hold short waves; fade their geometry
    // (the fragment shader still shades them).
    float amp = a.w * shoal * ( 1.0 - smoothstep( 2.5 * len, 3.5 * len, dist ) );
    float th = a.z * dot( a.xy, base ) - b.x * uTime + b.z;
    // Groups raise heights only; sideways motion stays capped so crests never loop.
    disp.xz += b.y * amp * a.xy * cos( th );
    disp.y += amp * mix( 1.0, gain, b.w ) * sin( th );
  }
  p.xz += disp.xz;
  p.y = uSeaLevel + disp.y;

  vWorld = p;
  vBase = base;
  vDepth = depth;
  vCrest = disp.y;
  vec4 mvPosition = viewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const waterFragment = shared + SKY_GLSL + /* glsl */ `
uniform vec3 uSunColor;
uniform float uSunVis;
uniform float uCloudShadow;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uLight;
uniform float uFlash;
uniform float uChop;
uniform float uFoam;
uniform float uAmpTotal;
uniform vec2 uDrift;               // accumulated wind drift of the ripples
uniform float uGustiness;
uniform sampler2D uDetail;
#include <fog_pars_fragment>

// The sky and its clouds, as reflected or seen through the surface.
vec3 skyColor( vec3 d ) {
  vec3 col = btSkyBase( d );
  vec4 cl = btClouds( d );
  col = mix( col, cl.rgb, cl.a );
  return btHorizon( d, col );
}

// Direct light let through by the clouds overhead.
float cloudLight( vec3 p ) {
  float t = ( ${CLOUD_HEIGHT.toFixed(1)} - p.y ) / max( uLightDir.y, 0.1 );
  vec2 q = p.xz + uLightDir.xz * t + uCloudOffset;
  return 1.0 - uCloudShadow * btCloudCoverage( texture2D( uCloudTex, q * ( 1.0 / 5200.0 ) ).r, uCloudCover );
}

void main() {
  float shoal = shoalFactor( vDepth );
  float dist = length( vBase - uCamPos.xz );

  // Analytic Gerstner normal, evaluated per pixel so it stays smooth at any distance.
  float gain = waveGroups( vBase );
  vec3 n = vec3( 0.0, 1.0, 0.0 );
  for ( int i = 0; i < NUM_WAVES; i ++ ) {
    vec4 a = uWaveA[ i ];
    vec4 b = uWaveB[ i ];
    float len = PI2 / a.z;
    float wa = a.z * a.w * shoal * ( 1.0 - smoothstep( 40.0 * len, 90.0 * len, dist ) );
    float th = a.z * dot( a.xy, vBase ) - b.x * uTime + b.z;
    n.xz -= a.xy * wa * mix( 1.0, gain, b.w ) * cos( th );
    n.y -= b.y * wa * sin( th );
  }

  // Gust patches ("cat's paws") sweep across the water: rougher, darker
  // ripples and more whitecaps where a gust is hitting.
  float gustPatch = texture2D( uDetail, vBase * 0.0035 - uDrift * 0.004 ).a;
  float gustMask = mix( 1.0, 0.35 + 1.3 * gustPatch, uGustiness );

  // Small ripples from a tiling normal map, drifting with the wind.
  vec4 d1 = texture2D( uDetail, vBase * 0.043 + uDrift * 0.018 );
  #if DETAIL_SAMPLES > 1
    vec4 d2 = texture2D( uDetail, vBase * 0.117 + vec2( uDrift.y, -uDrift.x ) * 0.03 );
  #else
    vec4 d2 = vec4( 0.5, 0.5, 1.0, d1.a );
  #endif
  vec2 ripple = ( d1.xy * 2.0 - 1.0 ) + ( d2.xy * 2.0 - 1.0 ) * 0.6;
  n.xz += ripple * uChop * gustMask * ( 1.0 - 0.7 * smoothstep( 60.0, 400.0, dist ) );
  n = normalize( n );

  vec3 V = normalize( uCamPos - vWorld );
  vec3 col;
  float alpha;

  if ( gl_FrontFacing ) {
    float ndv = max( dot( n, V ), 0.0 );
    float fresnel = 0.02 + 0.98 * pow( 1.0 - ndv, 5.0 );
    vec3 R = reflect( -V, n );
    R.y = abs( R.y );
    vec3 refl = skyColor( R );

    // Sun glitter only where the clouds let the sun through.
    float sunLit = uSunVis * cloudLight( vWorld );
    vec3 H = normalize( uLightDir + V );
    float nh = max( dot( n, H ), 0.0 );
    vec3 spec = uSunColor * sunLit * ( pow( nh, 600.0 ) * 8.0 + pow( nh, 60.0 ) * 0.3 );

    float shallow = 1.0 - smoothstep( 0.3, 9.0, vDepth );
    vec3 body = mix( uDeep, uShallow, shallow ) * uLight;
    // Light glowing through backlit crests.
    float crestH = clamp( vCrest / max( uAmpTotal * shoal, 0.05 ), 0.0, 1.0 );
    float sss = pow( clamp( dot( V, -uLightDir ) * 0.5 + 0.5, 0.0, 1.0 ), 3.0 ) * crestH;
    body += uShallow * sss * 0.5 * sunLit;
    col = mix( body, refl, fresnel ) + spec;

    // Foam: a broken band that surges along the shore, plus wind-whipped crests.
    float foamTex = d1.a * 0.65 + d2.a * 0.35;
    float surge = 0.5 + 0.5 * sin( uTime * 1.3 - vDepth * 4.0 + foamTex * 3.0 );
    float shore = ( 1.0 - smoothstep( 0.0, 0.9, vDepth ) ) * ( 0.55 + 0.45 * surge );
    float crest = smoothstep( 0.45, 0.95, crestH ) * uFoam * gustMask;
    float foam = smoothstep( 0.55, 0.85, foamTex + shore * 0.35 + crest * 0.5 ) * max( shore, crest );
    // Breakers: whitewater wherever waves are too tall for the depth.
    float surfZone = ( 1.0 - smoothstep( 0.8 * uBreakDepth, 2.0 * uBreakDepth, vDepth ) ) * step( 0.05, vDepth );
    foam = max( foam, surfZone * smoothstep( 0.35, 0.85, crestH + foamTex * 0.5 ) );
    col = mix( col, vec3( 0.9, 0.95, 1.0 ) * ( 0.25 + 0.75 * uLight ), foam );

    alpha = mix( 0.5, 0.95, smoothstep( 0.0, 6.0, vDepth ) );
    alpha = max( max( alpha, fresnel ), foam ) * smoothstep( -0.05, 0.35, vDepth );
  } else {
    // Seen from below: the sky shows through Snell's window, the rest is
    // total internal reflection of the depths.
    vec3 T = refract( -V, -n, 1.333 );
    vec3 inside = skyColor( normalize( T + vec3( 0.0, 0.001, 0.0 ) ) )
      + uSunColor * uSunVis * pow( max( dot( T, uLightDir ), 0.0 ), 300.0 ) * 4.0;
    vec3 outside = uDeep * 0.6 * uLight;
    // Transmission fades out approaching the critical angle (~48.6 degrees).
    float cosUp = dot( -V, n );
    col = mix( outside, inside, smoothstep( 0.64, 0.8, cosUp ) * step( 0.001, dot( T, T ) ) );
    alpha = 0.97;
  }

  col += uFlash * 0.35;
  gl_FragColor = vec4( col, alpha );
  // Same fog as the rest of the world: by true distance, glowing towards
  // the sun, applied before tone mapping.
  #ifdef USE_FOG
  {
    vec3 fv = vWorld - uCamPos;
    float fd = length( fv );
    float fogF = 1.0 - exp( - fogDensity * fogDensity * fd * fd );
    float toLight = pow( max( dot( fv / max( fd, 1e-3 ), uLightDir ), 0.0 ), 6.0 );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uFogColor, uFogSunColor, toLight ), fogF );
  }
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
