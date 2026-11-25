import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { fileURLToPath } from 'node:url';
import { createDatabase, type DatabaseHandle } from '../client.js';
import { runMigrations } from '../migrate.js';
import { seedReferenceData } from '../seeds/reference-data.js';

// Same image and role-creation script as local development (infra/docker), so tests exercise
// the real grants and RLS behaviour rather than a superuser connection.
const IMAGE = 'postgis/postgis:17-3.5';
const INIT_SCRIPT = fileURLToPath(
  new URL('../../../../infra/docker/initdb/01-roles.sh', import.meta.url),
);
const DATABASE = 'blue_test';
const MIGRATOR_PASSWORD = 'migrator_test';
const RUNTIME_PASSWORD = 'runtime_test';

export interface TestDatabase {
  container: StartedPostgreSqlContainer;
  /** Connected as app_migrator — for migrations and seeds only. */
  migratorUrl: string;
  /** Connected as app_runtime — what the API uses; subject to RLS and grants. */
  runtimeUrl: string;
  runtime: DatabaseHandle;
  stop: () => Promise<void>;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(IMAGE)
    .withDatabase(DATABASE)
    .withUsername('postgres')
    .withPassword('postgres')
    .withEnvironment({
      APP_MIGRATOR_PASSWORD: MIGRATOR_PASSWORD,
      APP_RUNTIME_PASSWORD: RUNTIME_PASSWORD,
    })
    .withCopyFilesToContainer([
      { source: INIT_SCRIPT, target: '/docker-entrypoint-initdb.d/01-roles.sh' },
    ])
    .start();

  const base = `${container.getHost()}:${container.getPort()}/${DATABASE}`;
  const migratorUrl = `postgres://app_migrator:${MIGRATOR_PASSWORD}@${base}`;
  const runtimeUrl = `postgres://app_runtime:${RUNTIME_PASSWORD}@${base}`;

  await runMigrations(migratorUrl);
  const migrator = createDatabase(migratorUrl, { maxConnections: 1 });
  await seedReferenceData(migrator.db);
  await migrator.close();

  const runtime = createDatabase(runtimeUrl);
  return {
    container,
    migratorUrl,
    runtimeUrl,
    runtime,
    stop: async () => {
      await runtime.close();
      await container.stop();
    },
  };
}

/** Postgres SQLSTATE from an error, whether or not Drizzle wrapped it. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === 'object' && 'code' in current && typeof current.code === 'string') {
      return current.code;
    }
    current = typeof current === 'object' && 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export async function expectPgError(promise: Promise<unknown>, sqlState: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (caught === undefined)
    throw new Error(`Expected SQLSTATE ${sqlState}, but the query succeeded`);
  const code = pgErrorCode(caught);
  if (code !== sqlState) {
    throw new Error(`Expected SQLSTATE ${sqlState}, got ${code ?? 'none'}: ${String(caught)}`);
  }
}

export const SQLSTATE = {
  insufficientPrivilege: '42501', // also raised for RLS WITH CHECK violations
  foreignKeyViolation: '23503',
  exclusionViolation: '23P01',
} as const;
