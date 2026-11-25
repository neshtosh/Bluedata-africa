import { defineConfig } from 'drizzle-kit';

// Migrations are generated from src/schema/managed and reviewed by hand (ADR-005).
// Objects Drizzle cannot express (partitioned tables, FORCE RLS, grants) live in custom SQL
// migrations; their TypeScript table definitions sit in src/schema/sql-managed, which is
// deliberately NOT listed here so drizzle-kit does not try to create them.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/managed/*.ts',
  out: './migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_MIGRATOR_URL ??
      'postgres://app_migrator:migrator_dev@localhost:5432/blue',
  },
  strict: true,
  verbose: true,
});
