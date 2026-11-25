import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests start PostGIS and Valkey containers.
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
});
