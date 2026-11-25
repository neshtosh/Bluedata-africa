// The full stack for browser tests, isolated from local development: throwaway PostGIS and
// Valkey containers, and the real API process on its own port with its log captured to a file.
import { startTestDatabase, type TestDatabase } from '@blue/database/testing';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

export const E2E_PORTS = { api: 4100, samakios: 3100, bluedata: 3102 } as const;
export const API_URL = `http://localhost:${E2E_PORTS.api}`;
export const SAMAKIOS_URL = `http://localhost:${E2E_PORTS.samakios}`;
export const BLUEDATA_URL = `http://localhost:${E2E_PORTS.bluedata}`;

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const artifacts = fileURLToPath(new URL('./.artifacts/', import.meta.url));
export const API_LOG = `${artifacts}api.log`;

export interface Stack {
  database: TestDatabase;
  valkey: StartedTestContainer;
  api: ChildProcess;
  stop: () => Promise<void>;
}

export async function startStack(): Promise<Stack> {
  mkdirSync(artifacts, { recursive: true });
  const [database, valkey] = await Promise.all([
    startTestDatabase(),
    new GenericContainer('valkey/valkey:8.1')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
  ]);

  // Run the API from source with tsx, exactly as `pnpm dev` does (no build step needed).
  const log = createWriteStream(API_LOG, { flags: 'w' });
  const api = spawn(process.execPath, ['--import', 'tsx', 'src/main.api.ts'], {
    cwd: `${repoRoot}apps/api`,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(E2E_PORTS.api),
      LOG_LEVEL: 'info',
      DATABASE_RUNTIME_URL: database.runtimeUrl,
      VALKEY_URL: `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`,
      AUTH_SECRET: 'e2e-test-secret-0123456789abcdefghij',
      SMS_PROVIDER: 'log',
      CORS_ORIGINS: `${SAMAKIOS_URL},${BLUEDATA_URL}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout?.pipe(log);
  api.stderr?.pipe(log);

  await waitForReady(api);
  return {
    database,
    valkey,
    api,
    stop: async () => {
      api.kill();
      await Promise.all([database.stop(), valkey.stop()]);
    },
  };
}

async function waitForReady(api: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null)
      throw new Error(`API exited early (code ${api.exitCode}); see ${API_LOG}`);
    try {
      const response = await fetch(`${API_URL}/health/ready`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API not ready after 90s; see ${API_LOG}`);
}

/** Current size of the API log, to read only lines written after an action. */
export function logMark(): number {
  try {
    return statSync(API_LOG).size;
  } catch {
    return 0;
  }
}

/**
 * The sign-in code texted to `phone` after `mark`, read from the development SMS log line —
 * the same place a developer reads it. The log masks numbers (+254*******33), so match on that.
 */
export async function waitForCode(
  phone: string,
  mark: number,
  timeoutMs = 15_000,
): Promise<string> {
  const masked = `${phone.slice(0, 4)}${'*'.repeat(phone.length - 6)}${phone.slice(-2)}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lines = readFileSync(API_LOG, 'utf8').slice(mark).split('\n');
    for (const line of lines.reverse()) {
      if (line.includes('DEV SMS') && line.includes(masked)) {
        const code = /code is (\d{6})/.exec(line)?.[1];
        if (code) return code;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No sign-in code for ${masked} within ${timeoutMs}ms; see ${API_LOG}`);
}
