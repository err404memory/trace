import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative paths so the app works from any folder (e.g. a GitHub Pages project URL).
  base: './',
  // MapLibre alone is ~800 kB; the app is one screen, so one chunk is fine.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
