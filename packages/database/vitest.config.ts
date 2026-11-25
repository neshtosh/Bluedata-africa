import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests start a PostGIS container; the first run may also pull the image.
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
});
