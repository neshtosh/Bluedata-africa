import { newId } from '@blue/primitives';
import { sql, type SQL } from 'drizzle-orm';
import {
  customType,
  integer,
  pgPolicy,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** Case-insensitive text (citext extension) — used for emails and slugs. */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** Raw bytes — used only for hashes (tokens, OTP codes, request bodies). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** UUIDv7 primary key generated in the application (ADR-006). */
export const idColumn = () => uuid('id').primaryKey().$defaultFn(newId);

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Optimistic-locking counter for mutable master data. */
export const version = () => integer('version').notNull().default(1);

/** Restricts a text column to a fixed set of values (text + CHECK, see DATABASE.md §1.1). */
export const oneOf = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.join(
    values.map((v) => sql.raw(`'${v.replaceAll("'", "''")}'`)),
    sql`, `,
  )})`;

/**
 * The standard tenant-isolation policy (ARCHITECTURE.md §9.2): a row is visible and writable
 * only inside a transaction whose app.org_id matches it. app.current_org_id() returns NULL when
 * no tenant context is set, so the comparison is never true and access fails closed.
 */
export const tenantIsolationPolicy = (organisationId: AnyPgColumn) =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    using: sql`${organisationId} = app.current_org_id()`,
    withCheck: sql`${organisationId} = app.current_org_id()`,
  });
