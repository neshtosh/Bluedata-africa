// The RDS bootstrap job against a brand-new PostGIS server (no application roles), as on first
// deploy: it must create the roles and extensions, be safe to re-run, and leave a database that
// the migrator can migrate and the runtime role can use.
import { createDatabase, runMigrations } from '@blue/database';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const apiRoot = fileURLToPath(new URL('..', import.meta.url));
let container: StartedPostgreSqlContainer;

function bootstrap(migratorPassword: string, runtimePassword: string) {
  return execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/bootstrap-db.ts'], {
    cwd: apiRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: container.getConnectionUri(),
      APP_MIGRATOR_PASSWORD: migratorPassword,
      APP_RUNTIME_PASSWORD: runtimePassword,
    },
  });
}

const url = (role: string, password: string) =>
  `postgres://${role}:${password}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:17-3.5')
    .withDatabase('blue_rds')
    .start();
}, 300_000);

afterAll(async () => {
  await container?.stop();
});

describe('bootstrap-db', () => {
  it(
    'creates roles and extensions, is idempotent, and rotates passwords on re-run',
    { timeout: 120_000 },
    async () => {
      expect(bootstrap('migrator-pw-1', 'runtime-pw-1')).toContain('bootstrapped');
      expect(bootstrap('migrator-pw-2', 'runtime-pw-2')).toContain('bootstrapped'); // safe to re-run

      // The new passwords work; migrations run as the migrator.
      await runMigrations(url('app_migrator', 'migrator-pw-2'));

      const runtime = createDatabase(url('app_runtime', 'runtime-pw-2'), { maxConnections: 1 });
      try {
        const { rows } = await runtime.db.execute<{ superuser: boolean; bypassrls: boolean }>(sql`
        select rolsuper as superuser, rolbypassrls as bypassrls from pg_roles where rolname = current_user
      `);
        expect(rows[0]).toEqual({ superuser: false, bypassrls: false });
        const extensions = await runtime.db.execute<{ extname: string }>(
          sql`select extname from pg_extension`,
        );
        expect(extensions.rows.map((r) => r.extname)).toEqual(
          expect.arrayContaining(['postgis', 'citext', 'pg_trgm', 'btree_gist']),
        );
      } finally {
        await runtime.close();
      }

      // The old password no longer works (rotation took effect).
      const stale = createDatabase(url('app_runtime', 'runtime-pw-1'), { maxConnections: 1 });
      await expect(stale.db.execute(sql`select 1`)).rejects.toThrow();
      await stale.close();
    },
  );

  it(
    'accepts admin credentials as standard PG* variables (how ECS injects the RDS secret)',
    { timeout: 120_000 },
    () => {
      const output = execFileSync(
        process.execPath,
        ['--import', 'tsx', 'src/scripts/bootstrap-db.ts'],
        {
          cwd: apiRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            DATABASE_ADMIN_URL: '',
            PGHOST: container.getHost(),
            PGPORT: String(container.getPort()),
            PGUSER: container.getUsername(),
            PGPASSWORD: container.getPassword(),
            PGDATABASE: container.getDatabase(),
            APP_MIGRATOR_PASSWORD: 'migrator-pw-3',
            APP_RUNTIME_PASSWORD: 'runtime-pw-3',
          },
        },
      );
      expect(output).toContain('Database "blue_rds" bootstrapped');
    },
  );

  it('refuses to run without admin credentials', () => {
    expect(() =>
      execFileSync(process.execPath, ['--import', 'tsx', 'src/scripts/bootstrap-db.ts'], {
        cwd: apiRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        env: {
          ...process.env,
          DATABASE_ADMIN_URL: '',
          PGHOST: '',
          PGUSER: '',
          APP_MIGRATOR_PASSWORD: 'x',
          APP_RUNTIME_PASSWORD: 'y',
        },
      }),
    ).toThrow(/Admin credentials/);
  });
});
