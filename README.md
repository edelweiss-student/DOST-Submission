# Borrowed Time

The sun is swelling and Earth is running out of time. A survival and
exploration game built with three.js: a realistic forested island, a smooth
wave-driven ocean with a reef and kelp forest to dive into, and a climate that
keeps shifting and gets worse the longer you survive.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome, Edge or Firefox and click to play.
`npm run build` makes a static build in `dist/`.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / swim (you swim where you look) |
| Mouse | Look (drag with the left button if mouse capture is blocked) |
| Shift | Sprint / swim fast |
| Space | Jump / swim up |
| C | Dive |
| M | Mute |
| P | Performance readout (fps, quality, render scale, GPU) |
| Esc | Pause |

Dev keys: `1`–`7` force a weather type (clear, overcast, rain, thunderstorm,
fog, heatwave, cold snap); press `4` again during a storm to make it worse.
`G` sends a rogue wave set at you, `T` skips an hour, `K` fast-forwards the
climate.
Add `?seed=1234` to the URL to generate a different island, or
`?quality=low|medium|high` to override the graphics tier.

## How the climate works

- Weather blends between seven presets. Each one sets cloud cover, rain,
  snow, fog, wind, waves, temperature, haze and lightning.
- **Instability** climbs from 0 to 1 over 25 minutes, driven by the sun's
  rising output. As it climbs, the weather changes more often, flips faster,
  and leans toward storms, heatwaves and cold snaps.
- The weather leaves traces behind: rain soaks the ground, cold snaps build
  up snow on terrain and trees, heatwaves brown the forest and bleach the
  coral. Each of these fades on its own afterwards.
- The sea rises up to 2.4 m over a session and slowly drowns the beaches.
- Every thunderstorm rolls a severity: Thunderstorm, Severe thunderstorm or
  Violent storm. Violent storms get likelier as instability climbs.

## Graphics

Everything is generated when the game starts; there are no image or model
files.

- **Sky.** A physically based atmosphere (Rayleigh and Mie scattering plus
  ozone) gives the blue day sky, sunsets and twilight. The GPU renders it
  into a small 64×48 table, re-rendered only when the sun moves or the haze
  changes. The CPU runs the same maths for a handful of directions to set the
  sunlight colour, the sky light and the fog colour. Clouds are a moving
  layer 1,400 m up, lit from the sun's side. Their shadows sweep across the
  ground, trees and water.
- **Light.** The sun casts shadows within 38 m (Medium) or 64 m (High) of the
  player. Shadows fade into a baked stand-in further out: the ground under
  tree crowns is darker. AgX tone mapping and a gentle eye adaptation keep
  noon, night, storms and fog readable. Fog is measured by true distance and
  glows towards the sun, so the land fades into the horizon colour.
- **Ground.** A smooth 2 m terrain mesh. The terrain shader blends four
  procedural materials (sand with wind ripples, grass, forest floor with leaf
  litter and needles, and rock) by height, slope and a forest map. The
  blending follows each texture's height, so grass grows between stones
  instead of cross-fading. Each material has detail normals, roughness and
  cavity shading. Sand the waves reach stays dark and glossy, and the seabed
  darkens with depth.
- **Trees.** Procedural spruces and broadleaf trees: tapered branch tubes
  with bark textures, and leaf and needle cards whose normals bend outwards
  from the crown, so a crown shades as one soft volume. Light shows through
  leaves from behind, leaves flutter, and whole trees sway with the wind.
  Trees within 38 m (Medium) are full 3D. Beyond that they are billboards,
  baked at startup with colour and normals so they light like the real tree,
  and dithered into view with no popping.
- **Grass, bushes and rocks.** 3D grass clumps around the player, placed
  entirely on the GPU, bend in rolling gusts and part around your feet.
  Boulders are noise-shaped and cut into facets, with rock texture and moss
  on top. Snow drifts, drought browning, wet darkening and coral bleaching
  work on every surface.
- **Seabed.** Kelp with swaying blades, branching, brain and table corals,
  textured boulders and fish that flex as they swim.

## Water

- The waves come from the wind. The sea is a bank of Gerstner wave
  components with fixed wavelengths (1.6–140 m) and directions. Their
  heights follow a real wind-sea model: fetch-limited JONSWAP growth, capped
  at a fully developed Pierson–Moskowitz sea. A low swell from the open
  ocean is always running underneath.
- Seas build up over about 20 seconds when the wind rises and take about 35
  seconds to settle afterwards. Fully developed seas:

  | Weather | Wind | Wave height (Hs) |
  | --- | --- | --- |
  | Fog, heatwave, clear | 6–11 km/h | about 0.3 m, calm |
  | Overcast | 16 km/h | 0.5 m |
  | Rain, cold snap | 30 km/h | 1.1 m, choppy |
  | Thunderstorm | 60 km/h | 2 m, rough |
  | Violent storm | 100 km/h | 3.3 m, very rough (biggest crests around 6 m) |

- Storm seas are irregular, not rows of identical rollers:
  - Energy follows the Pierson–Moskowitz spectrum, with a long tail of
    short, steep chop riding on the big waves.
  - Every component has its own random phase, and neighbouring wavelengths
    cross at alternating angles, so crests are short and broken.
  - Wave groups (sets) roll through at group speed, with lulls between them.
  - Gusts vary the wind by up to about ±30%. Gust patches sweep across the
    water as rougher, darker ripples with more whitecaps.
  - Severe and violent storms now and then send a rogue set: a ~90 m patch
    of waves up to twice the usual height, coming in from upwind.

  Measured at one spot in a violent storm: individual wave heights vary by
  about ±57% (a real sea is about ±52%). Rogue sets averaged a 6.8 m biggest
  wave, against 4.6 m without one.
- Near the shore, waves grow as the water gets shallow, then break into
  whitewater surf. The surf zone widens with the wave height.
- Shading is computed per pixel. It includes reflections of the sky and
  clouds that grow stronger at shallow viewing angles, sun glitter only where
  the clouds let the sun through, highlights from the sun or moon,
  light glowing through backlit crests, turquoise shallows over sand, foam
  along the shore and on stormy crests, and drifting ripples. Looking up from
  below, you see the sky through a circular window in the surface, as in
  real water.
- The same wave maths runs on the CPU for physics. You float on the real
  surface and bob with the swell. Wave motion and wind push you around,
  surf tugs at you while wading, your view tilts with the slope of the water,
  and jumping in makes a splash. `water.surface(x, z, t)` returns the
  height, water velocity and slope at any point, ready for multi-point
  buoyancy on a future raft.
- The shader reads the water depth from a texture of the terrain heights.
  That depth drives the shallow colour, the shoaling and the surf.

## Performance

At startup the game checks which GPU the browser is using and picks a
graphics tier:

| Tier | Typical GPU | Pixel ratio cap | Antialiasing | Sun shadows | 3D trees within | 3D grass | Textures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Low | Old or software GPUs | 0.8 | Off | None (baked stand-in) | 26 m | None | 256² |
| Medium | Intel / AMD integrated | 1.25 | On | 1024², 38 m, every other frame | 38 m | 16 m | 512² |
| High | GeForce RTX / Radeon RX | 1.5 | On | 2048², 64 m, softer edges | 64 m | 28 m, denser | 1024² |

Water quality is a separate setting on the pause screen (Esc), remembered
between visits. It defaults to High unless the GPU is in the Low tier.

| Water quality | Grid | Wave components | Ripple samples |
| --- | --- | --- | --- |
| Low | 128² | 6 | 1 |
| Medium | 192² | 9 | 2 |
| High | 256² | 12 | 2 |

How the realistic world stays fast:

- Distant trees are billboards: one draw call for the whole island.
- Near trees, billboards and grass are drawn nearest first, so leaves hidden
  behind other leaves fail the depth test instead of being shaded. Near
  trees and billboards are re-sorted every few metres you move; the sky is
  drawn after everything that covers it.
- Leaves cast shadows through half-density stand-ins, drawn only into the
  shadow map. Seen from the sun, the lower layers of a crown are hidden by
  the upper ones anyway.
- Shadow lookups read the shadow map 4 times per pixel on Medium (one
  bilinear lookup) instead of three.js's 17, and 16 on High for softer
  edges. Leaves read it once.
- Grass is placed, bent and faded entirely on the GPU. Its cards are trimmed
  to the blades' outline, so less empty space gets shaded.
- Seabed life, rocks and bushes are split into chunks, skipped when out of
  view or farther than you can see. Bushes dither out with distance.
- The terrain skips detail textures where they're too far to see.
- Alpha-tested leaves keep their coverage at a distance, so trees don't thin
  out and need extra cards to look full.
- Every shader is compiled before the first frame, so new things coming
  into view don't stall the game.

GPU time per frame on Medium, measured on the Intel Graphics (Core 5 210H)
laptop at 1600×900, clear midday: about 6.5 ms on the beach looking out to
sea, 10.5–11 ms looking inland or from the summit, and 13.5 ms in dense
forest with grass. That is 75–150 fps before any resolution scaling. Low
runs in 3–5 ms. High is meant for dedicated graphics cards: on this
integrated GPU it takes 12–25 ms. Press `P` to see GPU time (in browsers
that allow GPU timer queries), frame rate, draw calls and triangles.

Render resolution then adjusts automatically. It drops in 10% steps (down to
60–75%) if the frame rate falls under 50 fps, and climbs back when there is
headroom. Press `P` to watch it.

On laptops with two GPUs, browsers often use the integrated one. The start
screen points this out. To use the dedicated GPU, set the browser to "High
performance" in Windows Settings > System > Display > Graphics.

## Layout

```
src/
  main.js               bootstraps the scene and runs the game loop
  shared.js             world constants, shared shader uniforms, helpers
  core/quality.js       GPU detection, quality tiers, adaptive resolution, GPU timer, perf readout
  world/terrain.js      island heightmap, smooth terrain mesh, biome and canopy map, exact ground height
  world/textures.js     procedural textures: ground layers, bark, cloud noise, leaf/needle/grass sprites
  world/materials.js    shader patches: sway, snow, wetness, drought, caustics, cloud shadows,
                        fog, LOD dithering, terrain splatting, shadow filtering
  world/trees.js        procedural spruce, broadleaf tree, bush and boulder geometry
  world/vegetation.js   tree placement and colliders, near-tree LOD, billboard baking, bushes, rocks
  world/grass.js        GPU grass around the player
  world/waves.js        Gerstner wave spectrum, CPU surface sampling for physics
  world/water.js        water surface mesh, depth and ripple textures, uniforms
  world/waterShaders.js water vertex and fragment shaders
  world/splash.js       splash particles
  world/ocean.js        abyss floor, kelp, coral, seabed rocks, fish
  world/atmosphere.js   atmospheric scattering (GPU sky table, CPU colours)
  world/sky.js          sky dome, swollen sun, moon, stars, cloud layer, sun/sky light,
                        fog colours, shadow placement, exposure
  weather/weather.js    weather presets, climate instability, sea level
  weather/precipitation.js  GPU rain and snow, lightning
  player/player.js      walking, buoyant swimming, oxygen, health
  ui/hud.js             HUD panels and messages
  audio/ambience.js     synthesized wind, rain, surf, underwater, thunder, splashes
```

There are no hostile creatures yet. The fish are passive.
