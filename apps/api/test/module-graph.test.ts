// Loads the real entry modules in a plain Node process (tsx loader, native ESM rules).
// Vitest's module runner tolerates import cycles that real Node rejects — e.g. using a class
// before its module finished initialising — so a cycle can pass every other test and still
// crash `pnpm dev` and production. This test is what catches that.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));

describe('module graph', () => {
  it('the API and worker entry modules load under real Node ESM', () => {
    const script = [
      "await import('./src/create-app.ts');",
      "await import('./src/create-worker.ts');",
      "await import('./src/openapi/build-openapi.ts');",
      "console.log('modules loaded');",
    ].join(' ');
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      {
        cwd: apiRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(output).toContain('modules loaded');
  }, 180_000); // a cold tsx start is slow when the whole pipeline is building alongside
});
