import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './client.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies pending migrations. Must connect as app_migrator (the owner of all schemas). */
export async function runMigrations(migratorConnectionString: string): Promise<void> {
  const { db, close } = createDatabase(migratorConnectionString, { maxConnections: 1 });
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await close();
  }
}
