// Query-side definition of audit.audit_log. The table itself is created by the custom SQL
// migration (monthly range partitions, append-only grants), so this file is excluded from
// drizzle-kit. Keep the columns here in sync with migrations/*_audit_and_grants.sql.
import { inet, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn } from '../columns.js';

export const audit = pgSchema('audit');

export const ACTOR_TYPES = ['user', 'api_key', 'system', 'support'] as const;

export const auditLog = audit.table('audit_log', {
  id: idColumn(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  organisationId: uuid('organisation_id'),
  actorUserId: uuid('actor_user_id'),
  actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
  action: text('action').notNull(), // e.g. membership.role_assigned
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  changes: jsonb('changes'), // before/after diff, PII-minimised
  requestId: text('request_id'),
  ip: inet('ip'),
});
