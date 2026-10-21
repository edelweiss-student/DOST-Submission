# Borrowed Time

The sun is swelling and Earth is running out of time. A survival and
exploration game built with three.js: a realistic island, a smooth
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
| Shift | Sprint / swim fast (uses stamina) |
| Space | Jump / swim up |
| C | Dive |
| E | Gather from what you're looking at, or pick up an item |
| 1–9 / mouse wheel | Choose a hotbar slot |
| I / Tab | Open or close the inventory and crafting |
| Q | Drop one of the selected item |
| Right-click | Eat the selected item |
| M | Mute |
| P | Performance readout (fps, quality, render scale, GPU) |
| Esc | Pause (or close the inventory) |

Dev keys: `` ` `` then `1`–`7` forces a weather type (clear, overcast, rain,
thunderstorm, fog, heatwave, cold snap); `` ` `` then `4` again during a storm
makes it worse. `G` sends a rogue wave set at you, `T` skips an hour, `K`
fast-forwards the climate.
Add `?seed=1234` to the URL to generate a different island, or
`?quality=low|medium|high` to override the graphics tier.

## Inventory, gathering and crafting

You carry a **hotbar** of 9 slots along the bottom of the screen and a
**bag** of 27 more. Pick a hotbar slot with `1`–`9` or the mouse wheel; the
item's name shows above the hotbar when you switch.

Look at something within reach and press `E`. With the right tool selected
you get more, or something else:

| Source | Gives | With the right tool | Gathers before it runs out | One gather comes back every |
| --- | --- | --- | --- | --- |
| Tree | 1–2 sticks | Axe: 1–2 wood, sometimes a stick | 3 | 90 s |
| Bush | 1–2 plant fibre, often 1–2 berries | Knife: twice the fibre | 3 | 2 min |
| Boulder | 1–2 stones | Pickaxe: twice the stones | 4 | 5 min |
| Fallen trunk | 1 wood | Axe: 2 wood | 5 | 10 min |
| Grass | — | Knife: 1–2 fibre, never runs out | — | — |

Sources regrow in game time, so not while paused. Bushes the sea has killed
give only fibre. A message tells you when your bag is full; anything that
doesn't fit is left behind.

Items stack (sticks and stones 32, wood 16, fibre 48, berries 24). Berries
are food: right-click with them selected to get back 25 stamina and 6
health.

`Q` throws one of the selected item in front of you. Items in the world can
be picked up again with `E`. Stones sink; everything else floats, riding the
waves and drifting with the surf and wind, so dropped things can wash away
(or wash ashore). Up to 150 items lie around at once; the oldest disappear
first.

**Crafting** is on the inventory screen, next to the bag. Each recipe shows
how much of each ingredient you have (red when it's not enough); Craft uses
them up and puts the tool in your bag (or on the ground if the bag is full).
For now there are three stone tools:

| Tool | Needs | Uses before it breaks |
| --- | --- | --- |
| Makeshift knife | 1 stick, 1 stone | 40 |
| Stone axe | 2 sticks, 2 stones | 50 |
| Stone pickaxe | 2 sticks, 3 stones | 50 |

A tool is used up one gather at a time, and only where it does better (an
axe at a bush wears nothing). A bar under its slot shows the uses left, and
the tooltip gives the exact number. A selected tool is in your hand at the
lower right; it bobs as you walk and swings when you use it. Tools keep
their wear when moved, dropped or picked back up, and they sink in water.

`I` or `Tab` opens the inventory screen. It frees the mouse but doesn't
pause the game:

- Click a stack to pick it up, click a slot to put it down. Clicking a
  matching stack tops it up; a different one swaps with it.
- Right-click picks up half a stack, or puts down one at a time.
- Shift-click sends a stack between the bag and the hotbar.
- Hover a slot and press `1`–`9` to swap it with that hotbar slot.
- Click outside the panel to drop what you're holding.
- `I` or `Tab` closes it and goes back to the game; `Esc` closes it and
  pauses. Anything still in your hand goes back in the bag.

## How the climate works

- Weather blends between seven presets. Each one sets cloud cover, rain,
  snow, fog, wind, waves, temperature, humidity, haze and lightning.
- **Instability** climbs from 0 to 1 over 25 minutes, driven by the sun's
  rising output. As it climbs, the weather changes more often, flips faster,
  and leans toward storms, heatwaves and cold snaps.
- The weather leaves traces behind: rain soaks the ground, cold snaps build
  up snow on the ground and plants, heatwaves brown the land and bleach the
  coral. Each of these fades on its own afterwards.
- Every thunderstorm rolls a severity: Thunderstorm, Severe thunderstorm or
  Violent storm. Violent storms get likelier as instability climbs.
- The sea rises, and storms push it further inland (see below).
- Hot, humid weather wears you out faster (see Heat and stamina below).

## Sea level

The water level is the sum of three parts:

- **Rise.** The long-term climb as the planet warms: up to 2.4 m by the end
  of the climate ramp, speeding up as instability climbs.
- **Tide.** ±0.35 m, with two high tides a day.
- **Storm surge.** Storms pile water against the shore: about 0.3 m in a
  thunderstorm, up to 1.4 m in a violent storm. A surge builds over about a
  minute once the wind picks up and drains away over several minutes. A
  message warns you when one comes in. (Press `4` two or three times to see
  one.)

The HUD shows the rise so far, whether the tide is rising or falling, and any
surge. The level moves the whole sea, for the water you see and the water you
swim in, so the beaches drown and the surf climbs the shore.

Salt water leaves its mark wherever it reaches:

- Grass dies back and the ground turns to brown, salt-burnt soil. Both
  recover by about a metre every 15 minutes once the water retreats.
- Bushes whose roots the water reaches die for good: their leaves brown and
  drop away.

Structures will wear down the same way. `sea.exposure(x, z, y)` says how the
sea reaches a point (depth under the water, waves included; surf splash;
salt spray), and `sea.durabilityLoss(x, z, y, t, resistance)` turns that
into durability lost per second. Wood (resistance 1) lasts about 2–3
minutes a metre under water, about 15 minutes in the surf, and a few hours
in salt spray just above it. Rough seas wear it faster, and sturdier
materials pass a higher resistance (stone about 4).

## Heat and stamina

Sprinting and fast swimming use stamina, shown in a bar at the bottom of the
screen. Walking and swimming slowly bring it back, standing still fastest.
In mild weather a full bar lasts about 12 seconds of sprinting or 10 of fast
swimming, and refills in about 7 seconds standing still. Run it dry and you
can't sprint, and you move slower, until it is back to 30%. The bar pulses
while you are worn out.

Heat makes all of this worse:

- Every weather type has a humidity (rain, fog and storms are humid, cold
  snaps dry). Temperature and humidity together give the **heat index**:
  how hot it feels. It uses the US National Weather Service's formula (the
  Rothfusz regression) and is just the air temperature below about 27 °C.
  A heatwave at 43 °C and 30% humidity feels like 49 °C; once the climate
  has broken down, like 65 °C. Clear days reach about 32 °C by then.
- The weather panel shows the heat index next to the temperature
  ("feels 49°C") when it is clearly higher, in red from 41 °C. A message
  warns you when it reaches 41 °C (the NWS "danger" level) and again at
  54 °C ("extreme danger").
- How hot it feels to you depends on where you are. The heat index is
  measured in the shade: full sun adds up to 8 °C (less under cloud,
  nothing at night). Shade blocks the sun: tree crowns give the most (oaks
  most, eucalyptus least) and bushes a little.
  Plants the sea has killed give none. The sea is the real relief: water
  cools you to about 26 °C, and your body takes about 15 seconds to warm up
  again, so a swim keeps you cool for a while.
- From 27 °C you tire faster and recover slower, and the stamina bar turns
  orange once the heat is clearly wearing you down:

  | How hot it feels to you | Sprinting uses stamina | Stamina comes back |
  | --- | --- | --- |
  | Under 27 °C | as normal | as normal |
  | 41 °C | 2× as fast | ¾ as fast |
  | 54 °C | about 3× as fast | about half as fast |
  | 69 °C and up | 4× as fast | ¼ as fast |

  In an early heatwave a full bar lasts about 4 seconds of sprinting in the
  midday sun and 6–7 at night, against 12 on a mild day. Swimming in the
  sea, you tire no faster than on a mild day.

## Graphics

Everything except the trees is generated when the game starts. The trees
are the only model files (see Tree models below).

- **Sky.** A physically based atmosphere (Rayleigh and Mie scattering plus
  ozone) gives the blue day sky, sunsets and twilight. The GPU renders it
  into a small 64×48 table, re-rendered only when the sun moves or the haze
  changes. The CPU runs the same maths for a handful of directions to set the
  sunlight colour, the sky light and the fog colour. Clouds are a moving
  layer 1,400 m up, lit from the sun's side. Their shadows sweep across the
  ground and water.
- **Light.** The sun casts shadows within 38 m (Medium) or 64 m (High) of the
  player. Shadows fade into a baked stand-in further out: the ground under
  bushes is darker. AgX tone mapping and a gentle eye adaptation keep
  noon, night, storms and fog readable. Fog is measured by true distance and
  glows towards the sun, so the land fades into the horizon colour.
- **Ground.** A smooth 2 m terrain mesh. The terrain shader blends four
  procedural materials (sand with wind ripples, grass, forest floor with leaf
  litter and needles, and rock) by height, slope and a forest map. The
  blending follows each texture's height, so grass grows between stones
  instead of cross-fading. Each material has detail normals, roughness and
  cavity shading. Sand the waves reach stays dark and glossy, and the seabed
  darkens with depth. The forest floor still marks where the forest was.
- **Trees.** Birch, eucalyptus, oak and yerba mate, three variants each,
  from the 3D Retro World pack, plus fallen trunks on the forest floor.
  Eucalyptus grows in the lowlands, oaks on open low ground, birches up
  the hills and yerba mate as understorey and along the forest edges, all
  on the forest floor plus a few lone trees in the open. Up close each
  tree is the full model (about 2,000 triangles, alpha-tested leaves);
  further out it dithers into the model's own billboard. Billboards are lit
  like a rounded crown facing you, so they match the full trees. Trees sway in the wind (less
  the taller they are), their leaves flutter, they cast shadows, collect
  snow, brown in droughts and die when salt water reaches their roots. You
  can't walk through trunks or fallen trunks, and the crowns shade the
  ground (less grass grows there) and you.
- **Grass, bushes and rocks.** 3D grass clumps around the player, placed
  entirely on the GPU, bend in rolling gusts and part around your feet.
  Bushes are domes of leaf cards that sway, flutter and let light through
  from behind.
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

| Tier | Typical GPU | Pixel ratio cap | Antialiasing | Sun shadows | 3D grass | Textures |
| --- | --- | --- | --- | --- | --- | --- |
| Low | Old or software GPUs | 0.8 | Off | None (baked stand-in) | None | 256² |
| Medium | Intel / AMD integrated | 1.25 | On | 1024², 38 m, every other frame | 16 m | 512² |
| High | GeForce RTX / Radeon RX | 1.5 | On | 2048², 64 m, softer edges | 28 m, denser | 1024² |

Water quality is a separate setting on the pause screen (Esc), remembered
between visits. It defaults to High unless the GPU is in the Low tier.

| Water quality | Grid | Wave components | Ripple samples |
| --- | --- | --- | --- |
| Low | 128² | 6 | 1 |
| Medium | 192² | 9 | 2 |
| High | 256² | 12 | 2 |

How the realistic world stays fast:

- Grass is drawn nearest first (re-sorted every couple of metres you move),
  so blades hidden behind other blades fail the depth test instead of being
  shaded. The sky is drawn after everything that covers it.
- Shadow lookups read the shadow map 4 times per pixel on Medium (one
  bilinear lookup) instead of three.js's 17, and 16 on High for softer
  edges. Bushes read it once.
- Grass is placed, bent and faded entirely on the GPU. Its cards are trimmed
  to the blades' outline, so less empty space gets shaded.
- Seabed life, rocks and bushes are split into chunks, skipped when out of
  view or farther than you can see. Bushes dither out with distance.
- The terrain skips detail textures where they're too far to see.
- Alpha-tested leaves and blades keep their coverage at a distance, so
  bushes and grass don't thin out and need extra cards to look full.
- Trees are full models only near you (26 m on Low, 36 m on Medium, 95 m on
  High) and the models' own 12-triangle billboards beyond, out to 260, 400
  or 1,000 m. Both lists are rebuilt nearest first every couple of metres
  you move, so leaves and billboards hidden behind nearer ones fail the
  depth test instead of being shaded. Billboards inside the hand-over are
  skipped before any pixel is shaded.
- Every shader is compiled before the first frame, so new things coming
  into view don't stall the game.

GPU time per frame on Medium, measured on the Intel Graphics (Core 5 210H)
laptop at 1600×900, clear midday: about 5.5–6 ms on the beach or looking
inland, 9 ms from the summit, and 10.5 ms standing in thick grass. That is
95–180 fps before any resolution scaling. Low runs in about 4 ms. High is
meant for dedicated graphics cards: on this integrated GPU it takes 7–19 ms.
Those timings are from before the trees. Among the trees, the forest adds
roughly 3–6 ms (12.5–17 ms in total in dense woods), so on integrated
graphics the resolution may drop a step or two there.
Press `P` to see GPU time (in browsers that allow GPU timer queries), frame
rate, draw calls and triangles.

Render resolution then adjusts automatically. It drops in 10% steps (down to
60–75%) if the frame rate falls under 50 fps, and climbs back when there is
headroom. Press `P` to watch it.

On laptops with two GPUs, browsers often use the integrated one. The start
screen points this out. To use the dedicated GPU, set the browser to "High
performance" in Windows Settings > System > Display > Graphics.

## Tree models

The trees come from the 3D Retro World pack (version 0.01): Birch, Eucalyptus,
Mate and Oak (variants A, B and C of each) and the two fallen oak trunks
(OakBreakA and B). `scripts/import-trees.mjs` packs them into one `.glb` per
species in `public/models/trees` (93 MB in, 8.4 MB out):

- Each variant keeps its full tree and its billboard, moved to the origin.
- Textures shared by a species' variants are stored once and shrunk (leaves
  1024², bark and billboards 512²). The shrinking averages light in linear
  space and weights it by alpha, so leaf edges don't darken, and leaf colour
  is spread into the transparent texels so distant mipmaps don't fade to black.
- Billboards are matched to the brightness of their species' leaves (the
  oak's were much darker).
- Leaves and billboards become alpha-tested instead of blended. Wind vertex
  colours and lightmap UVs are dropped.

To re-import, for example after updating the pack:

```bash
npm run import-trees -- "<folder with Birch_A.glb, Oak_B.glb, ...>"
```

The script uses only Node's built-in modules. The download had no licence
file, so check the pack's terms before publishing the game.

## Layout

```
src/
  main.js               bootstraps the scene and runs the game loop
  shared.js             world constants, shared shader uniforms, helpers
  core/quality.js       GPU detection, quality tiers, adaptive resolution, GPU timer, perf readout
  world/terrain.js      island heightmap, smooth terrain mesh, biome and canopy map (also for shade),
                        exact ground height
  world/textures.js     procedural textures: ground layers, cloud noise, leaf/grass/kelp sprites
  world/materials.js    shader patches: sway, snow, wetness, drought, caustics, cloud shadows,
                        fog, distance dithering, terrain splatting, shadow filtering, salt damage
  world/props.js        procedural bush and boulder geometry
  world/trees.js        tree models: loading, where each species grows, near models and billboards
  world/vegetation.js   tree, fallen trunk, bush and boulder placement, colliders, culled instancing
  world/grass.js        GPU grass around the player
  world/waves.js        Gerstner wave spectrum, CPU surface sampling for physics
  world/water.js        water surface mesh, depth and ripple textures, uniforms
  world/waterShaders.js water vertex and fragment shaders
  world/splash.js       splash particles
  world/ocean.js        abyss floor, kelp, coral, seabed rocks, fish
  world/atmosphere.js   atmospheric scattering (GPU sky table, CPU colours)
  world/sky.js          sky dome, swollen sun, moon, stars, cloud layer, sun/sky light,
                        fog colours, shadow placement, exposure
  weather/weather.js    weather presets, humidity and heat index, climate instability
  weather/sealevel.js   sea level rise, tides, storm surge, salt damage lines, structure exposure
  weather/precipitation.js  GPU rain and snow, lightning
  player/player.js      walking, buoyant swimming, oxygen, health, stamina, heat strain, eating
  items/items.js        item definitions and their icons (drawn at startup)
  items/inventory.js    hotbar and bag slots: stacking, splitting, swapping, quick-move, tool wear
  items/recipes.js      crafting recipes
  items/models.js       low-poly item and tool models (in the world and in your hand)
  world/gathering.js    gathering from trees, bushes, boulders, fallen trunks and grass, tool
                        bonuses; items in the world
  player/heldItem.js    the selected tool in your hand: bobbing and swinging
  ui/hud.js             HUD panels, bars, messages and heat warnings
  ui/inventoryUI.js     hotbar, inventory screen, pickup feed and the E prompt
  audio/ambience.js     synthesized wind, rain, surf, underwater, thunder, splashes
scripts/
  import-trees.mjs      packs the tree pack's .glb files into public/models/trees
public/models/trees/    the packed tree models: one .glb per species, plus deadwood
```

There are no hostile creatures yet. The fish are passive.
