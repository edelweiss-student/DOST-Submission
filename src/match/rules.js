// The rules of a bed-wars match, shared by the game and the game server
// (server/match.js), so both count the same.
//
// Every team has one bed. It starts in every team member's inventory, and
// whoever places it first decides where it stands: anywhere outside the
// other teams' bases, within PLACE_REACH of them. A bed nobody has placed
// when the barriers come down goes down at its team's base. While it
// stands (or hasn't been placed yet), a player who goes down (knocked out,
// or drowned) comes back at it after RESPAWN_TIME; once it's destroyed
// (broken, or washed away when the flood reaches it), going down is for
// good: they're out. The last team with anyone left wins. Nothing can be
// hurt during the build phase.

export const BED_HP = 200;      // a bed's health
export const RESPAWN_TIME = 5;   // seconds from going down to coming back at your bed
export const REACH = 3.2;        // metres a swing reaches
export const PLACE_REACH = 5;    // metres from your eye to where you can put the bed down
export const KUBO_REACH = 12;    // metres from you to the middle of where your bahay kubo goes up
export const MAX_STAIRS = 3;     // stairs each player can build (on your own too: see world/building.js)
export const SWING_GAP = 200;    // ms: the server counts at most one hit per player this often

// What a swing does, by what's in your hand ('none' for a fist): to another
// player (health is 100), to a bed, and to a piece another team built
// (PIECE_HP each). The pickaxe is for beds, the axe for walls.
export const DAMAGE = {
  player: { none: 5, knife: 14, axe: 20, pickaxe: 16 },
  bed: { none: 3, knife: 5, axe: 12, pickaxe: 20 },
  piece: { none: 2, knife: 4, axe: 15, pickaxe: 10 },
};
export const PIECE_HP = 100;
export const damageOf = (target, tool) => DAMAGE[target][tool] ?? DAMAGE[target].none;

// Climate change in a match: not what anyone does to the island, but the
// same for every team, on the server's clock. Once the barriers are down a
// bagyo (typhoon) builds in STAGES, and the climate's pressure climbs with
// it, so the sea rises (up to 2.4 m: see weather/sealevel.js) and the
// storms push it further in. Any bed the water reaches is washed away; a
// bed raised high (in a bahay kubo on its stilts) stays dry. SURGE is the
// storm surge at the storm's peak; FINAL seconds later time is up: the
// team with the most players still in wins, and a tie is a draw. Times are
// seconds after the barriers come down; the server can shorten the storm
// for testing (--surge), and its stages and FINAL keep their places in it.
export const SURGE = 480;
export const FINAL = 180;
// Each stage starts at a fraction of the way to the surge. The storms'
// winds match the Philippines' wind signals (weather/weather.js): about
// 58 km/h (Signal No. 1), 76 (No. 2) and 98 (No. 3).
export const STAGES = [
  { at: 0, weather: 'rain' },
  { at: 0.25, weather: 'storm', severity: 0.15 },
  { at: 0.5, weather: 'storm', severity: 0.5 },
  { at: 0.75, weather: 'storm', severity: 0.95 },
];
// The climate's pressure (0..1) t seconds after the barriers come down,
// with the surge at `surge`.
export const pressureAt = (t, surge = SURGE) => Math.min(1, Math.max(0, t / surge));
