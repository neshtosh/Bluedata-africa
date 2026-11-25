import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DatabaseHandle {
  db: Database;
  /** Close the pool on shutdown (and at the end of tests). */
  close: () => Promise<void>;
}

/**
 * Creates a pooled connection. The API and worker connect as app_runtime (subject to RLS);
 * only migrations and seeds connect as app_migrator.
 */
export function createDatabase(
  connectionString: string,
  options: { maxConnections?: number } = {},
) {
  const pool = new pg.Pool({ connectionString, max: options.maxConnections ?? 10 });
  const handle: DatabaseHandle = {
    db: drizzle({ client: pool, schema }),
    close: () => pool.end(),
  };
  return handle;
}
