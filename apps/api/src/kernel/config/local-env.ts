import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Local development only: load the repo-root .env if present. Deployed environments inject
 * variables from the secrets manager and have no .env file, so this is a no-op there.
 */
export function loadLocalEnv(): void {
  // src/kernel/config → repo root (same depth from dist/kernel/config).
  const rootEnv = fileURLToPath(new URL('../../../../../.env', import.meta.url));
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
}
