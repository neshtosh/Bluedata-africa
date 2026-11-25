// Cross-cutting platform infrastructure: outbox, idempotency, document numbering.
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, idColumn, tenantIsolationPolicy } from '../columns.js';
import { users } from './identity.js';
import { organisations } from './tenancy.js';

export const system = pgSchema('system');

/**
 * Transactional outbox (ARCHITECTURE.md §13.1). Written in the same transaction as the business
 * change; relayed to the queue by the worker. Deliberately NOT under RLS: the relay must read
 * every tenant's events. Payloads carry IDs and minimal facts, never full documents or PII.
 */
export const outboxEvents = system.table(
  'outbox_events',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id').references(() => organisations.id),
    eventType: text('event_type').notNull(), // e.g. purchase.confirmed
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    index('outbox_events_unpublished_idx')
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

/**
 * Stored responses for Idempotency-Key replay (API.md §1). organisation_id is null for
 * non-tenant endpoints (e.g. organisation registration), which are scoped to the user instead.
 */
export const idempotencyKeys = system.table(
  'idempotency_keys',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id').references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    key: text('key').notNull(),
    requestHash: bytea('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('idempotency_keys_scope_key').on(t.organisationId, t.userId, t.key).nullsNotDistinct(),
    index('idempotency_keys_expiry_idx').on(t.expiresAt),
    pgPolicy('idempotency_keys_access', {
      for: 'all',
      using: sql`${t.organisationId} = app.current_org_id()
        or (${t.organisationId} is null and ${t.userId} = app.current_user_id())`,
      withCheck: sql`${t.organisationId} = app.current_org_id()
        or (${t.organisationId} is null and ${t.userId} = app.current_user_id())`,
    }),
  ],
);

/** Per-organisation document numbering (PO-2026-000123). Rows are locked FOR UPDATE on use. */
export const documentSequences = system.table(
  'document_sequences',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    documentType: text('document_type').notNull(),
    period: text('period').notNull(), // e.g. '2026'
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.organisationId, t.documentType, t.period] }),
    tenantIsolationPolicy(t.organisationId),
  ],
);
