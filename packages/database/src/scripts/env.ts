import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Local convenience: load the repo-root .env when present. Deployed environments inject
// variables directly from the secrets manager.
const rootEnv = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
