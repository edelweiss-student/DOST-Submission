// The four teams of a multiplayer match, each based on one of the island's
// diagonal shores (north is -Z, east +X; dir points from the centre to the
// shore). Shared by the game and the game server (server/index.js), so
// plain data only.
export const TEAMS = [
  { name: 'Red', color: '#ff6b6b', shore: 'north-east', dir: [1, -1] },
  { name: 'Blue', color: '#5fa8ff', shore: 'south-east', dir: [1, 1] },
  { name: 'Green', color: '#7fd67a', shore: 'south-west', dir: [-1, 1] },
  { name: 'Yellow', color: '#ffd257', shore: 'north-west', dir: [-1, -1] },
];

export const TEAM_SIZE = 4;      // most players on one team
export const NAME_LENGTH = 16;   // longest player name
