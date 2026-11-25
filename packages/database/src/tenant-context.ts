import { isId, type Id } from '@blue/primitives';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from './client.js';

export interface TenantContext {
  /** Organisation whose data this unit of work may touch. */
  organisationId: Id;
  /** Acting user, or null for system work (e.g. a scheduled job on behalf of a tenant). */
  userId: Id | null;
}

/**
 * Runs `work` in a transaction scoped to one organisation (ARCHITECTURE.md §9.2).
 * set_config(..., true) is transaction-local, so the context cannot leak to the next request
 * that reuses the pooled connection — this is also what makes PgBouncer transaction pooling safe.
 * Every RLS policy reads these values through app.current_org_id() / app.current_user_id().
 */
// async so that a validation failure is a rejected promise, never a synchronous throw.
export async function withTenantContext<T>(
  db: Database,
  context: TenantContext,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  assertId(context.organisationId, 'organisationId');
  if (context.userId !== null) assertId(context.userId, 'userId');
  return runScoped(db, context.organisationId, context.userId, work);
}

/**
 * Runs `work` as a signed-in user with no organisation selected — e.g. listing "my
 * organisations" or registering a new one. Tenant tables stay invisible except where a policy
 * explicitly allows user-scoped access (own memberships, organisations the user belongs to).
 */
export async function withUserContext<T>(
  db: Database,
  userId: Id,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  assertId(userId, 'userId');
  return runScoped(db, null, userId, work);
}

function runScoped<T>(
  db: Database,
  organisationId: Id | null,
  userId: Id | null,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${organisationId ?? ''}, true),
                 set_config('app.user_id', ${userId ?? ''}, true)`,
    );
    return work(tx);
  });
}

function assertId(value: unknown, name: string): asserts value is Id {
  // Rejected here rather than by Postgres so a bad ID never reaches set_config.
  if (!isId(value)) throw new TypeError(`${name} must be a UUID`);
}
