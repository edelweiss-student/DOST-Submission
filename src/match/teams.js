// The four teams of a multiplayer match, named for their colours in
// Filipino (red, blue, green and yellow), each based on one of the
// island's diagonal shores (north is -Z, east +X; dir points from the
// centre to the shore). Shared by the game and the game server
// (server/index.js), so plain data only.
export const TEAMS = [
  { name: 'Pula', color: '#ff6b6b', shore: 'north-east', dir: [1, -1] },
  { name: 'Asul', color: '#5fa8ff', shore: 'south-east', dir: [1, 1] },
  { name: 'Berde', color: '#7fd67a', shore: 'south-west', dir: [-1, 1] },
  { name: 'Dilaw', color: '#ffd257', shore: 'north-west', dir: [-1, -1] },
];

export const TEAM_SIZE = 4;      // most players on one team
export const NAME_LENGTH = 16;   // longest player name

// A match opens with a build phase: for BUILD_TIME seconds a barrier keeps
// the other teams out of every base, within BASE_RADIUS metres of it.
export const BUILD_TIME = 600;
export const BASE_RADIUS = 50;
