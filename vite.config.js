import { defineConfig } from 'vite';

export default defineConfig({
  // Keep file paths as given instead of resolving them to their real
  // location, which can differ for folders under a packaged app's AppData.
  resolve: { preserveSymlinks: true },
});
