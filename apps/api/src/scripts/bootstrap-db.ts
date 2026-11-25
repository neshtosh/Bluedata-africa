// One-time (and safely repeatable) database bootstrap for managed PostgreSQL (RDS), run as the
// admin/master user. Mirrors infra/docker/initdb/01-roles.sh, which does the same locally:
//   - application roles app_migrator (owns schemas) and app_runtime (DML only, subject to RLS);
//   - extensions that need elevated rights (PostGIS & co).
// Usage (API image): node dist/scripts/bootstrap-db.js, with APP_MIGRATOR_PASSWORD,
// APP_RUNTIME_PASSWORD and admin credentials as either DATABASE_ADMIN_URL or the standard
// PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE variables (how ECS injects the RDS-managed
// master secret's username and password fields, without assembling a URL).
import pg from 'pg';

const { DATABASE_ADMIN_URL, APP_MIGRATOR_PASSWORD, APP_RUNTIME_PASSWORD } = process.env;
const hasAdmin = Boolean(DATABASE_ADMIN_URL || (process.env.PGHOST && process.env.PGUSER));
if (!hasAdmin || !APP_MIGRATOR_PASSWORD || !APP_RUNTIME_PASSWORD) {
  process.stderr.write(
    'Admin credentials (DATABASE_ADMIN_URL or PGHOST/PGUSER/PGPASSWORD), APP_MIGRATOR_PASSWORD and APP_RUNTIME_PASSWORD are required\n',
  );
  process.exit(1);
}

// With no connection string, node-postgres reads the standard PG* environment variables.
const client = new pg.Client(DATABASE_ADMIN_URL ? { connectionString: DATABASE_ADMIN_URL } : {});
await client.connect();
try {
  const { rows } = await client.query<{ db: string }>('select current_database() as db');
  const database = rows[0]?.db;
  if (!database) throw new Error('could not determine current database');

  for (const [role, password] of [
    ['app_migrator', APP_MIGRATOR_PASSWORD],
    ['app_runtime', APP_RUNTIME_PASSWORD],
  ] as const) {
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [role]);
    // Identifiers are constants; the password is passed through format(%L) on the server side.
    const statement = exists.rowCount
      ? `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS PASSWORD %L`
      : `CREATE ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS PASSWORD %L`;
    const { rows: sql } = await client.query<{ q: string }>(
      'select format($1::text, $2::text) as q',
      [statement, password],
    );
    await client.query(sql[0]?.q ?? '');
  }

  await client.query(
    `GRANT CREATE, CONNECT ON DATABASE "${database.replaceAll('"', '""')}" TO app_migrator`,
  );
  await client.query(
    `GRANT CONNECT ON DATABASE "${database.replaceAll('"', '""')}" TO app_runtime`,
  );
  for (const extension of ['postgis', 'citext', 'pg_trgm', 'btree_gist']) {
    await client.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`);
  }
  process.stdout.write(`Database "${database}" bootstrapped (roles and extensions).\n`);
} finally {
  await client.end();
}
