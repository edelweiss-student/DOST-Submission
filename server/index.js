import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Server } from 'socket.io';
import { TEAMS, BUILD_TIME } from '../src/match/teams.js';
import { Lobby } from './lobby.js';

// The multiplayer game server: a lobby of up to four teams, and the match it
// starts. It decides the island (its seed), so every player generates the
// same one. It also serves the built game (npm run build), so on a LAN
// everyone just opens the address it prints. While developing, the Vite dev
// server passes Socket.IO through to it instead (see vite.config.js). Online,
// Render runs it the same way (see render.yaml).
//
//   npm run server                    a new island each time it starts
//   npm run server -- --seed 1234     a chosen island
//   npm run server -- --port 4000     another port (default: $PORT, else 3001)
//   npm run server -- --build 60      a 60-second build phase, for testing (default 600)

const { values: args } = parseArgs({ options: { seed: { type: 'string' }, port: { type: 'string' }, build: { type: 'string' } } });
// A host such as Render says which port to use in PORT.
const PORT = Number(args.port) || Number(process.env.PORT) || 3001;
const SEED = Number(args.seed) || randomInt(1, 2 ** 31);
const BUILD = Number(args.build) > 0 ? Number(args.build) : BUILD_TIME;
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

function reply(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

// The built game's files, and nothing outside dist/.
async function serveFile(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'Method not allowed');
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return reply(res, 400, 'Bad request');
  }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST + sep)) return reply(res, 403, 'Forbidden');
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    const modified = info.mtime.toUTCString();
    const headers = {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      // Built scripts and styles have a hash in their names, so a browser can
      // keep them. Everything else (the page, the models) is checked on each
      // visit, and only downloaded again when it has changed.
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Last-Modified': modified,
    };
    if (req.headers['if-modified-since'] === modified) {
      res.writeHead(304, headers);
      return res.end();
    }
    const body = await readFile(file);
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    if (path === '/index.html') return reply(res, 503, 'The game isn’t built yet. Run npm run build (or npm run lan), then reload.');
    reply(res, 404, 'Not found');
  }
}

const http = createServer(serveFile);
// Lobby messages are tiny; nothing a player sends should come near this.
const io = new Server(http, { maxHttpBufferSize: 64 * 1024 });
const lobby = new Lobby(SEED, BUILD);
const broadcast = () => io.emit('lobby', lobby.state);
const teamOf = (id) => TEAMS[lobby.players.get(id)?.team]?.name;
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
// When the build phase ends, the barriers come down and every base is open.
let opening = null;

io.on('connection', (socket) => {
  socket.emit('welcome', { seed: lobby.seed });
  socket.emit('lobby', lobby.state);
  // A request from this player: tell them if it was turned down, or
  // everyone if it changed something.
  const act = (change) => {
    const before = lobby.version;
    const error = change();
    if (error) socket.emit('notice', error);
    else if (lobby.version !== before) broadcast();
    return !error && lobby.version !== before;
  };

  socket.on('join', (name) => {
    if (act(() => lobby.join(socket.id, name))) console.log(`${lobby.players.get(socket.id).name} joined Team ${teamOf(socket.id)}`);
  });
  socket.on('team', (team) => act(() => lobby.setTeam(socket.id, team)));
  socket.on('ready', (ready) => act(() => lobby.setReady(socket.id, ready)));
  socket.on('start', () => {
    const error = lobby.start(socket.id);
    if (error) return socket.emit('notice', error);
    console.log(`Match started: ${lobby.players.size} player${lobby.players.size === 1 ? '' : 's'}, island ${lobby.seed}, ${clock(BUILD)} to build`);
    io.emit('start', { seed: lobby.seed, players: lobby.state.players, buildLeft: lobby.buildLeft });
    broadcast();
    clearTimeout(opening);
    opening = setTimeout(() => {
      console.log('The build phase is over: every base is open');
      io.emit('basesOpen');
      broadcast();
    }, lobby.buildLeft);
  });
  socket.on('disconnect', () => {
    const player = lobby.players.get(socket.id), playing = lobby.phase === 'playing';
    if (!act(() => lobby.leave(socket.id))) return;
    const over = playing && lobby.phase === 'lobby';
    if (over) clearTimeout(opening);
    console.log(`${player.name} left${over ? '; the match is over and the lobby is open again' : ''}`);
  });
});

http.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Try: npm run server -- --port ${PORT + 1}` : e);
  process.exit(1);
});

http.listen(PORT, () => {
  console.log(`Washed Away game server, island ${SEED}, ${clock(BUILD)} build phase`);
  // On Render: the address the game is reached at online.
  const online = process.env.RENDER_EXTERNAL_URL;
  if (online) return console.log(`  Online:   ${online}   (multiplayer: ${online}/?mp)`);
  // Every network this computer is on, named, since some are virtual ones (WSL, VPNs).
  const lan = Object.entries(networkInterfaces()).flatMap(([name, addresses]) => addresses
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${PORT}/?mp  (${name})`));
  if (existsSync(join(DIST, 'index.html'))) {
    console.log(`  On this computer:   http://localhost:${PORT}/?mp`);
    for (const url of lan) console.log(`  On your network:    ${url}`);
    if (lan.length) console.log('  If Windows asks, allow Node.js on private networks so others can join.');
  } else {
    console.log('  The game isn’t built yet: run npm run build (or npm run lan) to play over the network.');
  }
  console.log('  While developing: npm run dev, then open http://localhost:5173/?mp');
});
