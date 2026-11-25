import { defineConfig, devices } from '@playwright/test';
import { API_URL, BLUEDATA_URL, E2E_PORTS, SAMAKIOS_URL } from './stack.js';

const isCI = Boolean(process.env.CI);
// Own build directory, so e2e servers never clash with a developer's running `next dev`.
const webEnv = {
  NEXT_PUBLIC_API_URL: API_URL,
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_DIST_DIR: '.next-e2e',
};
// Run Next's own binary from the app folder: no dependency on pnpm being on PATH.
const nextDev = (port: number) => `node node_modules/next/dist/bin/next dev --port ${port}`;

export default defineConfig({
  testDir: './specs',
  // One shared stack and real accounts: run serially for determinism.
  workers: 1,
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // CI installs Playwright's Chromium; locally use the installed Microsoft Edge (no download).
    ...(isCI ? devices['Desktop Chrome'] : { ...devices['Desktop Edge'], channel: 'msedge' }),
  },
  // Next.js dev servers: they read NEXT_PUBLIC_API_URL at runtime, so no e2e-specific build.
  webServer: [
    {
      command: nextDev(E2E_PORTS.samakios),
      url: SAMAKIOS_URL,
      env: webEnv,
      reuseExistingServer: false,
      timeout: 180_000,
      cwd: '../../apps/samakios-web',
    },
    {
      command: nextDev(E2E_PORTS.bluedata),
      url: BLUEDATA_URL,
      env: webEnv,
      reuseExistingServer: false,
      timeout: 180_000,
      cwd: '../../apps/bluedata-web',
    },
  ],
});
