// The rules of a bed-wars match, shared by the game and the game server
// (server/match.js), so both count the same.
//
// Every team has a bed at its base. While it stands, a player who goes down
// (knocked out, or drowned) comes back at it after RESPAWN_TIME; once it's
// destroyed, going down is for good: they're out. The last team with
// anyone left wins. Nothing can be hurt during the build phase.

export const BED_HP = 200;      // a bed's health
export const RESPAWN_TIME = 5;   // seconds from going down to coming back at your bed
export const REACH = 3.2;        // metres a swing reaches
export const SWING_GAP = 200;    // ms: the server counts at most one hit per player this often

// What a swing does, by what's in your hand ('none' for a fist): to another
// player (health is 100) and to a bed. The pickaxe is for beds.
export const DAMAGE = {
  player: { none: 5, knife: 14, axe: 20, pickaxe: 16 },
  bed: { none: 3, knife: 5, axe: 12, pickaxe: 20 },
};
export const damageOf = (target, tool) => DAMAGE[target][tool] ?? DAMAGE[target].none;
