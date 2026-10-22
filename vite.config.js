import { defineConfig } from 'vite';

export default defineConfig({
  // Keep file paths as given instead of resolving them to their real
  // location, which can differ for folders under a packaged app's AppData.
  resolve: { preserveSymlinks: true },
  // main.js waits for the tree models at the top level (top-level await).
  build: { target: 'es2022' },
  // Multiplayer: the game server (npm run server) answers Socket.IO through
  // the dev server, so the game always connects to the address it came from.
  server: {
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true } },
  },
});
