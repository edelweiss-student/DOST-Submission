# Washed Away

Every tree you cut down brings the sea closer. A survival and exploration game
built with three.js, on a Philippine island: a smooth wave-driven ocean
with a reef and kelp forest to dive into, and a climate that keeps shifting
and answers what you do to the island. Strip it bare and the rising sea
washes it away. With friends, it's a fast bed-wars match for up to four
teams, each with its own bahay kubo, fought as a typhoon builds (see
Multiplayer).

**Play it online:** https://washed-away.onrender.com, and
https://washed-away.onrender.com/?mp for multiplayer. If nobody has played
for a while, the first visit takes about a minute while the server wakes up.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome, Edge or Firefox and choose Play,
then Singleplayer (see Menu).
`npm run build` makes a static build in `dist/`. To play with others on the
same network, see Multiplayer below; to play from a link, see Play online.

## Play online

The game is online at https://washed-away.onrender.com (add `/?mp` for
multiplayer), hosted on [Render](https://render.com) as one free web
service, set up by `render.yaml`. Render builds the game and runs the game
server, which serves it, multiplayer included. Every push to `master`
deploys the new version within a few minutes.

On the free plan the server sleeps after 15 minutes without visitors. The
next visit wakes it, which takes about a minute, and a woken server picks a
new multiplayer island.

**Setting it up** (once):

1. Sign in at https://dashboard.render.com with your GitHub account.
2. Choose **New > Blueprint** and give Render access to this repository. It
   can stay private.
3. Pick the repository. Render reads `render.yaml`; apply it to create the
   `washed-away` service.
4. The first build takes a few minutes. The service's page then shows its
   address.

## Menu

The game opens on its menu (`ui/menu.js`): a black panel down the left,
slanting wider towards the bottom, over the game's own sky and sea. It's
the live game seen through a camera of its own, riding the swell off the
island's west shore with the morning sun behind it (`menuView` in
`main.js`); your own camera waits where you'll start. Its pages:

- **Play**: **Singleplayer** starts on the island on your own, once it's
  made; **Multiplayer** lists the multiplayer modes, for now
  **Bedwars**, which opens the lobby (the same as `/?mp`).
- **Settings**: **Keybinds** shows every key (not dev mode's) on a tinted
  screen over the sea; **Water** and **Graphics** are the settings below.
- **Credits**: the tree and tool packs, and what the game is built with.

`Esc` or Back goes back a page. Pausing (`Esc` in the game) brings the
panel up over the game with **Resume** (or click the game beside it),
**Settings** and **Quit to menu** (**Leave the match** in a match), which
asks for a second click, since nothing on your island is kept. While the
menu is up, the game's panels, hotbar and tips keep out of the way.

**Settings**, remembered between visits:

| Setting | Choices | What it does |
| --- | --- | --- |
| Water quality | Low, Medium, High | Wave detail (see Performance). Medium by default on integrated graphics, High on a graphics card |
| Quality | Auto, Low, Medium, High | The graphics tier (see Performance). Auto picks one for the GPU the browser uses |
| Anti-aliasing | Auto, On, Off | Smooth edges (the tier's choice on Auto). Off draws about a third faster on integrated graphics |
| Dynamic resolution | Your screen, 120 fps, 60 fps, Off | The frame rate the render resolution adapts to keep (see Performance) |
| Performance readout | Off, On | The same as `P` |

Quality and anti-aliasing are set as the game loads. Changed from the menu
before you've started on your own, the game loads again at once and comes
back to the Graphics page; otherwise they wait for the next time it loads.

## Trailer

`/?trailer` opens the menu on a **Trailer** page (`trailer/trailer.js`): an
81-second trailer played live in the game, on this island, with nothing but
what the game does. **Preview** plays it; **Record** plays it and saves
`washed-away-trailer.mp4` (1920 × 1080 at 60 fps with the game's sound and
the music, about 160–190 MB) to your downloads when it ends. Record it in a browser
drawing on the graphics card, so no frames drop.

Its shots, after a cold open looking down on a lone survivor ("Every tree
you cut down brings the sea closer"): walking inland with an axe, felling a
tree, a house on stilts going up over the shallows, the fish over a reef, a
storm rolling in as the sea rises, the flood across the beach, four teams
round a bahay kubo with spears flying, a charge that breaks Team Asul's bed,
and the title over a storm at dusk. Captions name each feature, lower left.
Every sound effect is the game's own, as you'd hear it there: the axe
biting, the tree cracking, groaning and crashing down, spears whooshing
past and knocking in, a bed breaking, rain and thunder. The wind, rain and
surf are turned down in the felling and bed-wars shots so the action
carries.

Under it plays **Cold Metal Grip** (`public/audio/cold-metal-grip.mp3`,
82 s, made with Google's generative AI; see Credits), fetched only by the
trailer page. Its opening hits land on the cold open, it kicks in as the
walk inland starts, and it fades out with the title. It's mixed under the
game's sound with a little of its bass taken off, and lower still under
the felling and the bed wars, and the trailer keeps time by it, so even
late frames can't put the pictures out of step with it. The recording's
sound goes through a gentle compressor and a limiter, so it plays about as
loud as other trailers without clipping.
`game.playTrailer(false, seconds)` in the console starts it partway, to
look at one shot.

## Multiplayer

Bed wars for up to four teams, on a game server. Players join a lobby, are
put on teams, and spawn at their team's base, with its bahay kubo and bed
in their inventory to put up wherever they choose, when the host starts
the match. It opens with a 4-minute build phase behind barriers that keep
each team out of the others' bases; then it's a fast fight to be the last
team standing. Climate change comes as a typhoon on a fixed clock, the same
for every team: the weather worsens, the sea rises, and any bed the water
reaches is washed away. There's no time limit: 12 minutes in, the flood
comes and the sea climbs faster and faster until it's decided.

**On a LAN.** On the computer that hosts, run:

```bash
npm run lan
```

It builds the game and starts the game server, which prints the address to
open, such as http://192.168.1.20:3001/?mp (with the name of each network,
since some are virtual, like WSL's). Everyone on the same network opens it in
their browser; the host can use http://localhost:3001/?mp. If Windows asks,
allow Node.js on private networks. The server picks a new island each time it
starts: `npm run server -- --seed 1234` plays a chosen one, `--port`
picks another port, `--build 60` shortens the build phase to 60 seconds
and `--surge 120` brings the storm surge 2 minutes after the barriers come
down, both for testing.

**Online.** The hosted game (see Play online) runs the same server: everyone
opens its address with `/?mp`.

**While developing,** run `npm run server` beside `npm run dev` and open
http://localhost:5173/?mp: the dev server passes Socket.IO through to the
game server. Two browser tabs make two players.

**The lobby.** Play > Multiplayer > Bedwars in the menu opens it, in the
menu's panel, widened. Pick a name and join. You're put on the team with the fewest players (up to 4 a team, 16
in all), and you can switch to one with room, which takes back your Ready.
Or choose **Watch instead** to spectate (up to 16 watch): spectators have no
team and don't need to be Ready, and once every team is full, newcomers
watch. The first to join hosts, then the next in line if they leave; a
spectator can host too. Once every player is ready, the host starts the
match.

**Watching** (`match/spectator.js`), as a spectator or once you're out:
nobody sees you and you can't touch anything. You start high over the
island, flying freely: `WASD` moves the way you look, `Space` rises, `C`
sinks, `Shift` goes faster and the mouse looks around. Click to follow a
player from behind and above (click again for the next one; someone who
goes down is skipped), and right-click to fly freely from there. A bar at
the bottom says who you're watching. The map (`K`), mute (`M`) and the
teams panel still work; the rest of a player's screen is hidden.

Everyone who has joined stands in a line-up above the teams, grouped by
team, with a marker over you. Each player is a low-poly survivor
(`player/playerModel.js`): chunky, flat-shaded blocks with the shirt,
sleeves and headband in the team's colour, over grey trousers, brown boots,
a canvas backpack and a bedroll, under a salakot (the Philippines'
traditional woven hat). Switching teams recolours your survivor
straight away. It's one skinned mesh on an 11-joint skeleton, so one draw
call a player, with arms and legs that swing at the shoulders and hips and
bend at the elbows and knees. It walks in step with its speed and, standing
still, breathes and looks about. It's 1.85 m tall (2 m with the hat) with its eyes at 1.7 m,
where the first-person camera is, and it renders in the world with the
game's own lighting, fog and weather: in a match, it's how you see the
others.

**The bases.** Pula, Asul, Berde and Dilaw (red, blue, green and yellow in
Filipino) are based a little inland from
the island's north-east, south-east, south-west and north-west shores: the
first flat ground 20 to 80 m in from the beach that's at least 5 m above the
sea (it can rise 2.4 m, and storm surges 1.4 m more). They're worked out from
the island, so every player finds the same spots, about 180 m apart. You
spawn at yours facing the middle of the island.

**The build phase.** A match opens with 4 minutes of building
(`match/barriers.js`), timed by the server so every player's countdown agrees:
"Build phase · barriers down in 3:59" at the top of the screen, amber in the
last minute, with a warning when one minute is left.

- **Barriers.** A solid wall in each team's colour rings every base, 50 m
  out: 12 m high, far over anything you could build next to it, and 0.4 m
  thick, following the ground and the sea and reaching down to the seabed,
  so there's no seeing into a base from outside it or swimming under it.
  It's lit, shadowed and fogged like the rest of the world, with lighter
  ribs every few metres, a glowing top edge and faint glowing bands rising
  up it, so it shows at night too.
- **Who gets through.** Nobody from another team, however they try:
  walking, swimming, diving, climbing stairs or jumping off something
  built, you're stopped at its face, with a message saying how long until
  it opens. Nothing breaks it or takes it apart, and the game server
  ignores anyone who claims to be inside another team's base while it's
  up. Your own team's barrier lets you through, so you can leave your base
  to gather and come back.
- **The map** (`K`) rings each base with its barrier while the phase lasts.
- **When it ends,** and only then, the server opens the bases. The
  barriers sink into the ground, a message says every base is open, and
  anyone can go anywhere.
- **Intruders show.** From then on, anyone from another team inside your
  base (within its barrier's ring, 50 m) shows on your map as a dot in
  their team's colour with their name, and when they come in, a message and
  the feed say so.
- Nothing can be hurt until then: a swing at another team's player only
  gets a reminder.

**The storm** (`match/rules.js`). Climate change in a match is the same for
every team, on the server's clock, not what anyone does. When the barriers
come down a bagyo (typhoon) builds in stages about 80 seconds apart: rain bands
first, then storms of about 58, 76 and 98 km/h, which raise wind
Signals No. 1, 2 and 3. The climate's pressure climbs with it to Crisis, so
the sea rises (up to 2.4 m, and the storm's surge on top, peaking five and a
half minutes in) and floods the beaches. **Any bed the water reaches is washed
away**, as if it had been broken: once the water has stood over its foot for
a moment, its team can't come back after going down. A bed raised above
the flood, as in a bahay kubo on its stilts, stays dry. (The bases are at
least 5 m above the sea, so the flood mostly threatens beds put down low,
on the beaches and near the shore.)

**The flood.** There's no time limit. Two and a half minutes after the
surge, 12 minutes into the match, the flood comes: the sea stops waiting on
the storm and climbs faster and faster, 2 m a minute at first and 1 m a
minute faster every minute after (about 2.5 m in the first minute, 6 m in
two, 10 m in three, 16 m in four). It goes over the beaches, then the
bases, then the bahay kubos on their stilts, washing away every bed it
reaches, so going down soon means you're out. The last team with anyone
left wins. Every game raises the water itself from the match's clock, so
the flood is the same for everyone. The top of the screen counts down to
the surge, then to the flood, then shows how far it has risen; the weather
panel says what's coming next.

**The bahay kubo.** Each team has one, the house on stilts of the
Philippines (`world/building.js`, with its look in `world/kubo.js`): 4 m
square (2 × 2 building cells), its floor 1.8 m above the highest ground
under it, on bamboo stilts, with woven bamboo (sawali) walls, a door and
windows, a split-bamboo floor, a steep nipa-thatch roof that overhangs well
to shed typhoon rain, and bamboo steps up to the door.

- It starts in every player's hotbar (it can't be dropped). Select it and
  it shows see-through where it would go (green, or red with the reason);
  right-click puts it up at once, like a Rust shelter, and `R` turns which
  way its door faces. It snaps to the building grid.
- It goes on dry ground clear of trees, rocks and builds, with room in
  front of the door for the steps, anywhere but another team's base (the
  game server checks that, and that you're within 12 m). Whoever puts it up
  first decides where; it leaves everyone else's hotbar then.
- One nobody put up when the barriers come down goes up a little behind
  its team's spawn, door facing the middle of the island, and a bed nobody
  placed goes down inside it.
- It's built from the same pieces as anything else, so you walk up its
  steps, stand on its floor, shelter under its roof and are stopped by its
  walls. Its pieces are well joined and can be repaired with planks (and
  logs, for the stilts), but not taken apart for their wood. Another team
  can break them like any build: break a stilt and the floor on it falls,
  with what stands on that. Your own team's tools can't touch it.
- Its door opens for your team only (`E`). To anyone else it's locked:
  they have to break it down (or come in some other way).

**Bed wars** (`match/bedwars.js`, with the rules in `match/rules.js`):

- **The others.** Every other player shows as a survivor in their team's
  colour, with their name overhead. Each game sends where its player is 20
  times a second, through the server, and draws the others a tenth of a
  second behind, so they move smoothly and walk in step. What's in their
  selected hotbar slot shows in their right hand (a tool or spear gripped
  upright, anything else in the palm; never the bed or bahay kubo), and
  you see them swing it, throw, and draw a spear back over the shoulder.
- **Fighting.** Left-click (with the mouse captured) or `F` swings what's in
  your hand, and so does right-click with a tool. The swing lands on
  whatever is nearest under the crosshair within 3.2 m: another team's
  player or bed, or anything built, any team's, your own included, except
  your own team's bahay kubo, which stops it. With nothing of those in
  reach, a tool does its usual work (a tree to fell, a log to split). The
  hit counts as the swing lands. A hit flashes the crosshair red and wears
  the tool. Being hit flashes the edges of the screen red and knocks you
  back. Health is 100 and comes back slowly on its own, but only 6
  seconds after you were last hurt: in a fight, eat berries (20 health a
  handful). Each hit does:

  | In your hand | To a player | To a bed | To a build |
  | --- | --- | --- | --- |
  | Nothing | 5 | 3 | 2 |
  | Knife | 14 | 5 | 5 |
  | Axe | 20 | 12 | 5 |
  | Pickaxe | 16 | 20 | 5 |
  | Spear (jab) | 16 | 4 | 5 |

  A bed has 200 health (10 blows of a pickaxe, 17 of an axe) and a built
  piece 100: every tool takes 5% off it a blow, so 20 blows break it. A thrown spear hurts another team's
  player for 18 to 45, by how far it was drawn back (beds and builds it only
  sticks in). The thrower's game sees the hit and the server checks it: one
  hit a throw, within 90 m of where it was thrown from, and none in the
  build phase. Everyone sees a thrown spear fly.
- **Building.** What's built is shared: every piece you place, build up,
  repair or take down shows in everyone's game, as your team's. Another
  team's pieces can't be built on or taken apart, only broken with tools,
  so walls around your bed keep raiders out until they hack through. Nobody
  can build within 50 m of another team's base, and in a match what's built
  doesn't weather.
- **Beds.** Each team has one bed, in its colour (`match/beds.js`). It
  starts in every player's inventory (it can't be dropped), and whoever
  places it first decides where it stands; it leaves everyone else's
  inventory then. Select it and the bed shows see-through where it would
  go (green, or red with the reason); right-click puts it down and `R`
  turns it. It goes anywhere dry: in your base or out in the woods, on the
  ground (it tips to follow a slope; only cliffs are too steep) or on a
  finished floor you've built (your bahay kubo's is the safest). Only
  another team's base is out of bounds, and the game server checks that
  too, and that you're within 5 m. A bed nobody has placed when the
  barriers come down goes down in its team's bahay kubo. While it stands
  (or is still in your inventory), a player who goes down (knocked out, or
  drowned) lies where they fell and comes back beside it 5 seconds later.
  Once it's destroyed or washed away, going down is for good: you're out. A
  few seconds later you watch the rest of the match (see Watching above).
- **The end.** The last team with anyone left wins (players who leave are
  out), or, when time runs out after the surge, the team with the most
  players still standing. Everyone sees who won, and "Back to the lobby"
  goes back for the next match.
- **On screen,** under the weather: every team's bed (its health, "bed not
  placed" or "no bed") and how many of its players are left, and below it
  a feed of who went down and which beds broke or washed away. You're
  warned when your bed is under attack.

**The server** (`server/`) decides the island (its seed), so every player
generates the same one, and a player whose server restarts with another
island reloads onto it. It checks every request: names lose invisible
characters and are cut to 16, only the host can start, and only once
everyone is ready. It only sends out real changes. It also referees the
fight (`server/match.js`): it checks every hit (other team, both up, within
reach, not too often), keeps the beds' health, and decides who comes back
and who's out. It passes on what's built, each piece stamped with its
team, times the storm and its surge, and calls time. Newcomers wait while a
match is on; when it's over, or once
everyone has left it, the lobby opens again. Single-player never loads
Socket.IO.

**Not shared yet:** felling and gathering still run separately on each
player's machine (a tree you fell still stands in the others' games), and
so do the tides. The weather and the sea level follow the match's clock, so
they agree.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / swim (you swim where you look) |
| Mouse | Look (drag with the left button if mouse capture is blocked) |
| Shift | Sprint / swim fast (uses stamina) |
| Space | Jump / swim up |
| C | Dive |
| E | With your hands: gather from what you're looking at, pick something up, build and repair |
| Right-click | Use the selected item: swing a tool (fell a tree, split a log, cut a log off a fallen trunk, cut grass or a bush with the knife, break something built), eat food, or in a match put up your team's bahay kubo or place its bed (`R` turns it) |
| Hold right-click | With the spear: draw it back (the meter under the crosshair fills), let go to throw it |
| Left-click / F | Jab with the spear; in a multiplayer match, strike with whatever's in your hand (a fist if nothing): another team's player or bed, or anything built in the way |
| 1–9 / mouse wheel | Choose a hotbar slot |
| I / Tab | Open or close the inventory and crafting |
| K | Open or close the map |
| Q | Drop one of the selected item, or put down the wood you're carrying |
| B | Build mode: `1`–`8` or the wheel choose a piece, `R` turns it, `Z` raises or lowers pilings, `E` (or left-click) places it, `B` or right-click leaves |
| E on a build | Add the wood you carry, repair it with a plank (or log), or with empty arms open or shut a door, or rework the joints of anything else |
| Hold X | Take apart something you built, or clear a blueprint |
| M | Mute |
| H | Hide the tips |
| P | Performance readout (fps, quality, render scale, GPU) |
| Esc | Pause: the menu (or close the inventory; in the menu, back a page) |

Settings > Keybinds in the menu lists these, and the keys of the inventory
screen and the joinery mini-game.

**Tips.** A first game shows one tip at a time at the bottom left
(`ui/tutorial.js`), each done when you do what it says. On your own: walk,
pick up sticks and stones, eat some berries, craft an axe, fell a tree,
build, and what the climate panel means. In a match: put up your bahay
kubo, place your bed, gather, craft a pickaxe, wall in your bed, and
strike. `H` hides them for good.

**Dev mode**, for testing, is hidden: press `` ` `` five times in quick
succession (within about 2½ seconds) to turn it on, and five times again to
turn it off. A "Dev mode" badge shows at the top of the screen while it's
on, and the menu lists its keys. Its keys do nothing while it's off:

- `` ` `` then `1`–`7` forces a weather type (clear, overcast, rain,
  thunderstorm, fog, heatwave, cold snap); `` ` `` then `4` again during a
  storm makes it worse.
- `T` skips an hour.
- `G` sends a rogue wave set at you.

In multiplayer, dev mode only changes your own game for now, since the
weather and the time of day aren't shared yet.

Add `?seed=1234` to the URL to generate a different island, or
`?quality=low|medium|high` to override the graphics tier.

## Map

`K` opens a map of the island, drawn from the terrain itself, with north up
and a 100 m scale bar. It shows:

- the sea where it is now, so as the sea rises the beaches shrink on the map;
- every tree still standing (felled trees disappear from it, so you can see
  where you've cleared);
- what you've built: floors and pilings as cells, walls, windows, doors,
  railings and stairs along their edges, and blueprints in outline;
- in a multiplayer match, the four team bases in their colours, with yours
  marked, and their barriers ringed while the build phase lasts; once it's
  over, other teams' players inside your base, as dots in their colours
  with their names (spectators see every player);
- you, as an arrow pointing the way you face, and the name of the region
  you're in.

It stays up while you move and redraws a few times a second, but while it's
open you can't act on what's in front of you. `K` again, or opening the
inventory, closes it.

## Inventory, gathering and crafting

You carry a **hotbar** of 9 slots along the bottom of the screen and a
**bag** of 27 more. Pick a hotbar slot with `1`–`9` or the mouse wheel; the
item's name shows above the hotbar when you switch.

Look at something within reach: `E` gathers it with your hands, and with
the right tool selected, right-click swings the tool at it for more, or for
something else:

| Source | `E` gives | Right-click with the right tool | Gathers before it runs out | One gather comes back every |
| --- | --- | --- | --- | --- |
| Bush | 1–2 plant fibre, often 1–2 berries | Knife: twice the fibre | 3 | 2 min |
| Grass | — | Knife: 1–2 fibre, never runs out | — | — |
| Tree | — | Axe: fells it (see Timber and building) | — | — |
| Fallen trunk | — | Axe: cuts a log off it | 3 | 10 min |
| Boulder | — | Pickaxe: mines 2–3 stones | 4 | 5 min |

Sources regrow in game time, so not while paused. Bushes the sea has killed
give only fibre. Without the right tool, a tree, a fallen trunk or a
boulder only says what it needs. A message tells you when your bag is full; anything that
doesn't fit is left behind.

**Sticks and stones** lie loose on the ground: sticks near the trees (about
3 in 5 trees have one within a few metres, and a felled tree's crown leaves
more), and stones in little piles of 1 to 3 on the beaches. Look at one and
press `E` to pick it up. It's gone for good, so they get scarcer as the
island is picked over; after that, mine boulders with a pickaxe.

Items stack (sticks and stones 32, fibre 48, berries 24). Wood isn't an
item: it never goes in the bag (see below). Berries are food: right-click
with some selected to get back 25 stamina and 20 health, a handful a
second at most. Health comes back on its own too (2 a second), but only 6
seconds after you were last hurt (in a match, or drowning), so eating is
how you heal in a fight.

`Q` throws one of the selected item in front of you. Items in the world can
be picked up again with `E`. Stones sink; everything else floats, riding the
waves and drifting with the surf and wind, so dropped things can wash away
(or wash ashore). Up to 150 items lie around at once; the oldest disappear
first.

**Crafting** is on the inventory screen, next to the bag. Each recipe shows
how much of each ingredient you have (red when it's not enough); Craft uses
them up and puts the tool in your bag (or on the ground if the bag is full).
There are three stone tools and a spear:

| Tool | Needs | Uses before it breaks |
| --- | --- | --- |
| Makeshift knife | 1 stick, 1 stone | 40 |
| Stone axe | 2 sticks, 2 stones | 150 |
| Stone pickaxe | 2 sticks, 3 stones | 50 |
| Spear | 2 sticks, 1 stone, 2 plant fibre | 30 throws |

A tool is used up one blow at a time, and only when it hits something it
works on (a swing at the air wears nothing). A bar under its slot shows the
uses left, and the tooltip gives the exact number. Whatever is in the
selected hotbar slot shows in your hand at the lower right: a tool or the
spear in your grip, sticks, stones, fibre or berries in your open palm (the
team's bed and bahay kubo show where they'd go instead). It bobs as you walk and swings when you
right-click, and its work is done when the swing lands. `E` is only ever
your hands. Every tool breaks what's built (see Timber and building); the
pickaxe mines stones from boulders, and in a multiplayer match it's the
quickest way through an enemy bed. The knife and pickaxe strike down and forward. The axe chops level: it swings back to the right,
sweeps across from right to left and bites in edge first right where the
crosshair is, jolts with the blow, then pulls back. You can't start another
swing until one is nearly over. Tools keep their wear when moved, dropped or
picked back up, and they sink in water.

**The spear** (`world/spears.js`) is thrown. With it selected, hold
right-click to draw it back: a meter under the crosshair fills over about
a second, and letting go throws it, from 11 m/s on a quick toss to 27 m/s
fully drawn, plus however fast you were moving. It flies under gravity,
point first, and sticks where it strikes: the ground, a tree, a fallen
trunk, a boulder or something built. Go and pick it up again with `E`.
Thrown into the sea it floats, to swim after. Each throw wears it a little
(30 throws). Left-click (with the mouse captured) or `F` jabs with it
instead, which breaks things built like a weak tool.

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

## Timber and building

Wood comes from trees, and it's carried in your arms, never in the bag.

**Felling.** Select the axe, look at a tree and right-click to chop. Each blow
shakes the tree. It takes 3 blows for a yerba mate, 4 for a birch, 6 for a
eucalyptus and 8 for an oak, more for a big one; the prompt counts them.
On the last blow the tree topples away from you, speeding up as it goes,
and hits the ground with a thud. A moment later the trunk lies there as
logs, 1 for a mate up to 4 for a tall eucalyptus. The crown leaves a few
sticks behind and a stump stays where it stood. The ground under it loses
its shade (and the grass comes back). If you walk away from a half-chopped
tree, the cuts stay. The fallen trunks already in the forest give a log for
each axe cut, 3 before you have to wait for more. Every tree you fell takes
something out of the island's climate for good; dead wood costs it nothing
(see How the climate works).

**Logs and planks.** These are physical: they lie where they fall, roll to
rest along the ground, float, and drift with the waves and the wind.

- With the axe selected, right-click a log to split it. Two blows and it
  falls apart into 4 planks.
- `E` picks a log or plank up, whatever is selected. You can carry 2 logs
  or 8 planks, one kind at a time.
- Logs are heavy: one stops you sprinting and two slow you by a third. Your
  arms are full while you carry wood, so you can't gather or use tools
  until you put it down.
- `Q` puts one down in front of you, across your path. If you black out,
  you drop everything you carry.

**Building.** Press `B` and the hotbar turns into the build bar. `1`–`8`
or the mouse wheel choose a piece, `R` turns it and `Z` sets how high
pilings stand:

| Key | Piece | Costs | Goes |
| --- | --- | --- | --- |
| 1 | Floor | 6 planks | On posts on the ground or out over the water, snapped to a 2 m grid, or on top of pilings (`R` turns its boards) |
| 2 | Wall | 6 planks | Along the floor edge nearest the crosshair (`R` turns it round the floor, a side at a time) |
| 3 | Door | 7 planks | A wall with a doorway and a plank door hung in it. `E` opens it (it swings in, over the floor it was built from) and shuts it; shut, it stops you like a wall. In a match only your own team can open your doors: anyone else has to break them |
| 4 | Roof | 8 planks | Over a floor: a pitched roof with boarded gable ends (`R` turns the ridge) |
| 5 | Pilings | 4 logs | Four log stilts driven into the ground or the seabed. A floor goes on top of them, 2, 3, 4 or 5 m above the water (`Z` changes the height). Two diagonal log braces stiffen two opposite sides (`R` turns them to the other two) |
| 6 | Window | 5 planks | A wall with a window in it |
| 7 | Railing | 3 planks | Along a floor edge, so you don't fall off |
| 8 | Stairs | 5 planks | Steps you walk up, at about 40° from a floor edge (an open one, or a door's doorway) down to the ground, the seabed, or a lower floor in the way (they land on it), for floors 0.6 to 6 m up. Everyone can build 3 at most (a bahay kubo's own steps don't count); take one apart to build another |

A see-through preview follows the crosshair: green where the piece fits,
red (with the reason) where it doesn't. A floor levels itself above the
highest ground under it, matches the height of a floor next to it, and
can't go where trunks, stumps or boulders are in the way or where its
posts would be longer than 5 m. Pilings line up with pilings or floors next
to them, so decks meet. When you choose pilings, the build bar says how
much further the sea may still rise. Press `E` to place a **blueprint**.

Then bring the wood: planks, or logs for pilings. With it in your arms, look
at the blueprint and press `E` to add one; the piece grows board by board.
Once it has everything it's solid: you stand on floors (and step or climb
onto them, even out of the water), walls, shut doors and railings stop you,
pilings stand in your way, and a roof shades you from the sun like a tree's
crown and keeps the rain off what's under it.

**Getting up there.** There are no ladders: stairs take you up to a raised
floor (6 m at most), a floor less than about 2 m above the water can be
climbed onto straight out of it, and floors at the same height join, so a
walkway on pilings can run out from a floor you reached by stairs. Stairs
can go down from a high floor onto a lower one beside it (from about 0.6 m
lower: any closer and you just step down).

**Joinery.** When a piece gets its last plank, you make its joints in a
quick mini-game. `E`, `Space` or a click works each step:

1. **Saw the tenon:** stop the saw on the pencil line.
2. **Chisel the mortise:** tap to cut deeper, then stop inside the marked
   depth. Cut too deep and the joint is loose.
3. **Drive the pegs:** strike as the mallet swings down onto the peg, three
   times.

How well it went sets the joints: Rough, Sound, Tight or Masterful. Better
joints make the piece sturdier, so weather and sea wear it down more
slowly: masterful joints last nearly twice as long as rough ones. `X` skips
the mini-game and leaves rough joints. Later, look at a piece with empty
arms and press `E` to rework its joints; you keep whichever joints are
better.

**Everything you build wears down**, and needs looking after from time to
time. Look at a piece to see how it's doing: its condition, its joints,
whether it's soaked, and how high it stands above the water.

- Wood ages in any weather: left alone, a piece wears out in a little over
  an hour of play.
- Rain soaks it unless a roof is over it, and wet wood rots faster. It
  dries out again in the sun, faster in a heatwave.
- Storm winds batter it, the harder the higher it stands; roofs and walls
  catch the most. A violent storm can take a third off an exposed wall.
- Snow weighs on roofs, and droughts crack the wood.
- The sea does the most damage (see Sea level below). Anything it floods or
  its surf reaches wears down fast: a low floor dies in a minute or two
  under a storm surge. It leaves a high-water mark on what it reached:
  stained green with weed below, crusted with salt along the line. A
  message warns you when the sea is nearly up to something you built.
- Pilings are made to stand in water. Only the surf works on them, and
  logs are tough, so they last several times longer than planks. Building
  up on pilings, above where the sea will reach, is how to stay ahead of it.

Worn wood greys and darkens, and below about half its condition, boards
start falling off. To **repair** a piece, carry a plank (a log, for pilings)
to it and press `E`: each one brings it back 40% (50% for a log). A message
warns you when something drops below 35%, and the build bar counts what
needs repairs. When a piece wears through it gives way, along with whatever
stood on it, and its wood falls or floats away.

Holding `X` for a moment on a piece takes it apart and gives all its wood
back; on a blueprint it clears it and gives back what it had. A floor can't
be taken apart while walls, a roof or stairs stand on it, nor pilings with
a floor on top.

**Breaking it.** Any tool breaks what's built, at a cost. With a tool
selected, right-click a finished piece: each blow takes off as much of its
condition as it would of another team's in a match (5% for any tool, so
20 blows; see Bed wars), and the piece darkens as it goes. At nothing it breaks,
with whatever stands on it, and only half the wood in each is left lying
where it stood. A piece that's only been knocked about can be repaired
like a worn one.

## How the climate works

The climate is an entity that answers what you do to the island
(`src/climate/entity.js`), and nothing else drives it: there's no clock
counting it down. Leave the island be and the climate stays balanced; how
far and how fast it breaks down is up to you. (In a multiplayer match it
follows the match's typhoon instead: see Multiplayer.)

- **Regions.** The world is split into a 16 × 16 grid of 45 m regions, 62
  of them with some land. Each is named for where it lies and what it's
  like: "South woods", "Central hills", "North-east shore".
- **What it keeps track of.** A felled tree takes its wood (height × trunk
  thickness²) out of its region's forest for good, so big eucalyptus and
  oaks count far more than yerba mate. Cutting bushes and grass strips the
  ground, which recovers by half every 15 minutes. Building covers the
  ground (a floor 4 m², a wall a strip of it) until it comes down. What's
  lying about is free: loose sticks and stones, and logs cut off fallen
  trunks.
- **Stress.** A region's stress (0–1) weighs how much of its forest is gone
  (0.45), how stripped its ground is (0.2) and how built over it is (0.05),
  scaled to the causes the game has so far (fire and hunting will join
  them). It spills over a little into the regions around. Past 0.6 a region
  tips: it recovers half as fast, and its bare ground washes away in the
  rain, so it keeps getting worse after you leave. Clear-cutting a valley
  tips it.
- **Pressure.** The climate's pressure (0–100%) is the island's stress:
  half its worst-hit region (one wrecked valley counts), half how much of
  it is damaged in all.
- **Tiers.** The pressure moves the climate through four tiers: Balanced,
  Unstable (from 30%), Severe (55%) and Crisis (80%). It has to stay past
  the threshold for a minute to go up a tier, and below a lower one (22%,
  47%, 70%) for two minutes to come back down, so it doesn't flicker. A
  message says when it turns, and why. Clearing about 30 big trees out of
  one valley, or the whole valley, makes it unstable (30 small ones
  don't). Stripping that valley's ground bare too, or clear-cutting three,
  makes it severe, and about four wrecked valleys (clear-cut, then stripped
  or washed out by the rain) bring on a crisis.
- **Weather.** The weather blends between seven presets, each setting cloud
  cover, rain, snow, fog, wind, waves, temperature, humidity, haze and
  lightning. What comes next isn't rolled: each kind comes round in
  proportion to its share (stride scheduling), so the same choices give the
  same weather. As the pressure rises, storms, heatwaves and cold snaps take
  a bigger share, and the weather changes more often and flips faster.
  Cleared land brings more heatwaves and less rain and fog, built-over
  ground more heatwaves, and after a heatwave a cold snap is likely, the
  more so the higher the pressure.
- **Storms** come as a Thunderstorm, Severe thunderstorm or Violent storm,
  by the pressure, and worse if the land where you are is stressed.
- **Wind signals.** As a storm's sustained wind passes 39, 62, 89, 118 and
  185 km/h, the Philippines' Tropical Cyclone Wind Signals No. 1 to 5 go up. The
  weather panel shows the signal, and a message gives its advice as it
  rises. The game's storms reach Signal No. 3.
- **Temperature.** Warm weather runs 1.5, 3 and 5 °C hotter in the
  Unstable, Severe and Crisis tiers, and cold snaps colder. Cleared land is
  up to 4 °C hotter than forest on a warm day: it has lost its shade and
  holds the heat.
- The weather leaves traces behind: rain soaks the ground, cold snaps build
  up snow on the ground and plants, heatwaves brown the land and bleach the
  coral. Each of these fades on its own afterwards.
- The sea rises with the pressure, and storms push it further inland (see
  below).
- Hot, humid weather wears you out faster (see Heat and stamina below).

The climate panel shows the tier and the pressure, with ▲ or ▼ while it's on
its way to the next tier up or down, and how the region you're in is doing
(healthy, strained, stressed or degrading) and what's stressing it most.

## Sea level

The water level is the sum of three parts:

- **Rise.** The long-term climb as the climate warms. It follows the
  climate's pressure, steeper as it climbs: none while the island is left
  alone, about 0.5 m once the climate turns unstable, 1.1 m when it's
  severe, 1.8 m at the start of a crisis, and 2.4 m with the climate at its
  worst. It catches up over a couple of minutes, and never comes back
  down: melted ice stays melted.
- **Tide.** ±0.35 m, with two high tides a day.
- **Storm surge.** Storms pile water against the shore: about 0.3 m in a
  thunderstorm, up to 1.4 m in a violent storm. A surge builds over about a
  minute once the wind picks up and drains away over several minutes. A
  message warns you when one comes in. (In dev mode, `` ` `` then `4` two or
  three times shows one.)

The HUD shows the rise so far, whether the tide is rising or falling, and any
surge. The level moves the whole sea, for the water you see and the water you
swim in, so the beaches drown and the surf climbs the shore.

Salt water leaves its mark wherever it reaches:

- Grass dies back and the ground turns to brown, salt-burnt soil. Both
  recover by about a metre every 15 minutes once the water retreats.
- Bushes whose roots the water reaches die for good: their leaves brown and
  drop away.

What you build wears down the same way. `sea.exposure(x, z, y)` says how
the sea reaches a point (depth under the water, waves included; surf splash;
salt spray), and `sea.durabilityLoss(x, z, y, t, resistance)` turns that
into durability lost per second. Wood (resistance 1) lasts about 2–3
minutes a metre under water, about 15 minutes in the surf, and a few hours
in salt spray just above it. Rough seas wear it faster, and sturdier
materials will pass a higher resistance (stone about 4). Floors are worn
from the underside of the deck (their posts are meant to stand in water),
walls and roofs from their base. Pilings only take the surf, and their logs
outlast planks several times over. Better joints slow all of it (see Timber
and building).

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
  A heatwave at 43 °C and 30% humidity feels like 49 °C; in a climate in
  crisis, like 62 °C, and on land you've cleared, 74 °C. Clear days reach
  about 29 °C by then, 33 °C on cleared land.
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

Everything except the trees and tools is generated when the game starts.
The trees and tools are the only model files (see Tree models below).

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
graphics tier (Settings > Graphics > Quality can choose another):

| Tier | Typical GPU | Pixel ratio cap | Antialiasing | Sun shadows | 3D grass | Textures |
| --- | --- | --- | --- | --- | --- | --- |
| Low | Old or software GPUs | 0.8 | Off | None (baked stand-in) | None | 256² |
| Medium | Intel / AMD integrated | 1.25 | On | 1024², 38 m, every other frame | 16 m | 512² |
| High | GeForce RTX / Radeon RX | 1.5 | On | 2048², 64 m, softer edges | 28 m, denser | 1024² |

Water quality is a separate setting (Settings > Water), remembered between
visits. It defaults to High on the High tier and Medium otherwise: on
integrated graphics High costs several frames a second.

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

**There is no frame rate cap** in the game. Browsers draw in step with the
screen, so the most you'll see is its refresh rate (60, 120, 165 Hz…), and
below that the GPU sets the pace. Measured on a laptop's Intel Graphics at
1920×1080 (October 2026, Medium): about 40 fps among the trees and 55–58
over the sea, so it can look stuck at 60.

**Dynamic resolution** then adjusts the render resolution. The game times
the screen's refresh rate before it draws anything (`measureRefresh` in
`core/quality.js`), and by default aims for it: while the frame rate is
under 90% of the target, the resolution drops 5% (10% if it's well short),
down to 60–75%; while frames keep pace, it climbs back 5% at a time, and a
step that fell short isn't tried again for half a minute. Settings >
Graphics can aim for 120 or 60 fps instead, or turn it off. (Before, it
only dropped under 50 fps and climbed back over 90, so on a 60 Hz screen it
never climbed back.) Press `P` to watch it.

On that same Intel laptop, what the settings buy (fps among the trees /
over the sea):

| Settings | Trees | Sea |
| --- | --- | --- |
| Medium, full resolution | 40 | 55 |
| Medium, dynamic resolution at its 70% floor | 63 | 71 |
| Medium, anti-aliasing off, full resolution | 54 | 72 |
| Medium, anti-aliasing off, 80% | 64 | 97 |
| Low | 100 | 120 |

On laptops with two GPUs, browsers usually draw on the integrated one,
however fast the other is. The menu points this out when it sees Intel or
AMD integrated graphics (and the performance readout's last line names the
GPU in use). To use the dedicated GPU, set the browser to "High
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

The script uses only Node's built-in modules. The pack is free to use:
credit isn't required but is appreciated, so the game credits it here (see
Credits) and on the menu's Credits page.

## Tool models

The knife, axe and pickaxe are from Kay Lousberg's **KayKit : RPG Tools
Bits** (free version, CC0: <https://kaylousberg.itch.io/rpg-tools-bits>).
`scripts/import-tools.mjs` packs the three into `public/models/tools.glb`
(61 KB):

- The colours each model takes from the pack's palette texture are baked
  into its vertices, so the tools share the one material every item uses,
  and the texture isn't needed.
- The game's tools are stone-headed, so metal (the pack's greys and
  blue-greys) becomes stone, keeping each part's light-to-dark gradient.
- Each tool is turned to stand on its grip at the origin, handle up and
  head facing +X, and scaled to the game: a 30 cm knife, a 55 cm axe (more
  hatchet than felling axe) and a 62 cm pickaxe.

In your hand each has its own size and grip position (`player/heldItem.js`);
lying in the world they rest on their side, head flat. To re-import, for
example to swap in other tools from the pack:

```bash
npm run import-tools -- "<the pack's Assets/gltf folder>"
```

## Layout

```
src/
  main.js               bootstraps the scene and runs the game loop
  shared.js             world constants, shared shader uniforms, helpers
  core/quality.js       GPU detection, quality tiers, graphics settings, the screen's refresh rate,
                        dynamic resolution, GPU timer, perf readout
  world/terrain.js      island heightmap, smooth terrain mesh, biome and canopy map (also for shade),
                        exact ground height
  world/textures.js     procedural textures: ground layers, cloud noise, leaf/grass/kelp sprites
  world/materials.js    shader patches: sway, snow, wetness, drought, caustics, cloud shadows,
                        fog, distance dithering, terrain splatting, shadow filtering, salt damage
  world/props.js        procedural bush and boulder geometry
  world/trees.js        tree models: loading, where each species grows, near models and billboards,
                        lifting one tree out to shake and fall
  world/vegetation.js   tree, fallen trunk, bush and boulder placement, colliders, culled instancing
  world/wood.js         wood materials and shapes: bark, plank grain, cut ends, logs, boards
  world/timber.js       felling, stumps, logs and planks in the world, splitting, carrying
  world/spears.js       thrown spears: flight, sticking where they strike, picking up again, hits in a match
  world/building.js     floors, pilings, walls, windows, doors, railings, stairs and
                        roofs: placing, blueprints, building up, joints, weather and sea wear,
                        high-water marks, repairs, taking apart, turning, standing, colliding,
                        roof shade; the bahay kubo; shared between the players of a match
  world/kubo.js         the bahay kubo's materials: bamboo, sawali, split-bamboo slats, nipa thatch
  world/grass.js        GPU grass around the player
  world/waves.js        Gerstner wave spectrum, CPU surface sampling for physics
  world/water.js        water surface mesh, depth and ripple textures, uniforms
  world/waterShaders.js water vertex and fragment shaders
  world/splash.js       splash particles
  world/ocean.js        abyss floor, kelp, coral, seabed rocks, fish
  world/atmosphere.js   atmospheric scattering (GPU sky table, CPU colours)
  world/sky.js          sky dome, sun, moon, stars, cloud layer, sun/sky light,
                        fog colours, shadow placement, exposure
  climate/entity.js     the Climate Entity: regions, what you've done to each, stress, the
                        climate's pressure and tiers, local warming
  weather/weather.js    weather presets, humidity and heat index, the weather scheduler, storm
                        strength
  weather/sealevel.js   sea level rise, tides, storm surge, salt damage lines, structure exposure
  weather/precipitation.js  GPU rain and snow, lightning
  player/player.js      walking, buoyant swimming, oxygen, health, stamina, heat strain, eating
  items/items.js        item definitions and their icons (drawn at startup)
  items/inventory.js    hotbar and bag slots: stacking, splitting, swapping, quick-move, tool wear
  items/recipes.js      crafting recipes
  items/models.js       item models: the imported tools, simple shapes for the rest (in the world
                        and in your hand)
  world/gathering.js    gathering from bushes and grass, felling, cutting fallen
                        trunks, tool bonuses; loose sticks and stones; items in the world
  player/heldItem.js    the selected tool in your hand (bobbing and swinging), or the wood you carry
  player/playerModel.js the low-poly player model in team colours, with a salakot: skeleton, walk
                        and idle
  ui/hud.js             HUD panels, bars, messages, heat warnings and the climate readout
  ui/inventoryUI.js     hotbar, inventory screen, pickup feed, what you carry and the prompt
  ui/buildUI.js         the build bar, its piece icons and what needs repairs
  ui/joinery.js         the joinery mini-game: saw, chisel and pegs
  ui/tutorial.js        tips for a first game, one at a time, on your own or in a match
  ui/menu.js            the menu: its pages, settings rows, the keybinds screen, Esc to go back
  ui/lobbyUI.js         the multiplayer lobby, in the menu
  ui/lineupUI.js        the lobby's line-up of everyone who has joined, in team colours
  ui/mapUI.js           the map (K): terrain, the sea, standing trees, what you've built, bases,
                        intruders in your base, you
  match/teams.js        the four multiplayer teams (shared with the game server)
  match/bases.js        where each team's base is: inland from its diagonal shore
  match/barriers.js     the build phase's solid walls around each base: building them, keeping
                        other teams out, and sinking them when it ends
  match/multiplayer.js  multiplayer: connecting, the lobby, starting the match, the build phase,
                        the storm on the match's clock, no-build zones
  match/rules.js        the bed-wars rules: health, damage, reach, respawning, the storm and its
                        surge, the stairs limit (shared with the game server)
  match/spectator.js    watching a match: flying freely, or following a player
  trailer/trailer.js    the trailer (/?trailer): its shots, captions and title, played and
                        recorded live in the game
  match/bedwars.js      bed wars in your game: your team's bahay kubo and bed from your
                        inventory, the flood washing beds away, striking, being hit, going down,
                        coming back or being out, the teams panel and feed, the end of the match
  match/remotePlayers.js  the other players: drawn smoothly from the server's updates, name tags,
                        what a swing hits
  match/beds.js         each team's bed: the model, where it can go (and the see-through preview),
                        where it stands, coming back beside it, what a swing hits
  net/net.js            the connection to the game server (Socket.IO, loaded only for multiplayer)
  audio/ambience.js     synthesized wind, rain, surf, underwater, thunder, splashes, wood sounds,
                        a thrown spear's whoosh
server/
  index.js              the game server: serves the built game (with caching), runs the lobby
                        and the match over Socket.IO
  lobby.js              the lobby's rules: joining, teams, ready, the host, starting
  match.js              the match's referee: where everyone is (and nobody in another team's base
                        during the build phase), where beds are placed, hits, beds, who's down
                        or out, who won
scripts/
  gltf.mjs              glTF, GLB and PNG reading and writing for the import scripts
  import-trees.mjs      packs the tree pack's .glb files into public/models/trees
  import-tools.mjs      packs the knife, axe and pickaxe into public/models/tools.glb
public/models/trees/    the packed tree models: one .glb per species, plus deadwood
public/models/tools.glb the packed tool models
render.yaml             hosting on Render: the build and start commands (see Play online)
```

There are no hostile creatures yet. The fish are passive.

## Credits

The trees and fallen trunks come from the **3D Retro World** pack (version
0.01), which is free to use. Thank you to its creator.

The knife, axe and pickaxe are from **KayKit : RPG Tools Bits** by Kay
Lousberg (<https://www.kaylousberg.com>), released under CC0. Thank you,
Kay.

The trailer's music, **Cold Metal Grip**, was made with Google's generative
AI for this trailer; the file carries Google's content credentials and an
imperceptible SynthID watermark saying so. It's disclosed with the rest of
the AI use (Form 03).
