// Global identities. A user exists independently of any organisation; organisation access is
// granted through tenancy.memberships. Accessed only by the identity module — not tenant-scoped.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, citext, createdAt, idColumn, oneOf, updatedAt } from '../columns.js';
import { organisations } from './tenancy.js';

export const identity = pgSchema('identity');

export const USER_STATUSES = ['active', 'suspended', 'deleted'] as const;

export const users = identity.table(
  'users',
  {
    id: idColumn(),
    displayName: text('display_name').notNull(),
    email: citext('email'),
    phoneE164: text('phone_e164'),
    locale: text('locale').notNull().default('en'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    phoneVerifiedAt: timestamp('phone_verified_at', { withTimezone: true }),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Phone-first identity: at least one identifier is required (ARCHITECTURE.md §10.1).
    check('users_has_identifier', sql`${t.email} is not null or ${t.phoneE164} is not null`),
    check('users_phone_e164_format', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('users_status_valid', oneOf(t.status, USER_STATUSES)),
    uniqueIndex('users_email_key')
      .on(t.email)
      .where(sql`${t.email} is not null`),
    uniqueIndex('users_phone_key')
      .on(t.phoneE164)
      .where(sql`${t.phoneE164} is not null`),
  ],
);

export const CREDENTIAL_TYPES = ['password', 'totp', 'external_oidc'] as const;

export const userCredentials = identity.table(
  'user_credentials',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: CREDENTIAL_TYPES }).notNull(),
    // Argon2id hash for passwords; encrypted secret for TOTP. Never plaintext.
    secretHash: text('secret_hash'),
    provider: text('provider'),
    providerSubject: text('provider_subject'),
    createdAt: createdAt(),
  },
  (t) => [
    check('user_credentials_type_valid', oneOf(t.type, CREDENTIAL_TYPES)),
    // One password and one TOTP secret per user; many external identities allowed.
    uniqueIndex('user_credentials_single_local_key')
      .on(t.userId, t.type)
      .where(sql`${t.type} <> 'external_oidc'`),
    uniqueIndex('user_credentials_external_key')
      .on(t.provider, t.providerSubject)
      .where(sql`${t.type} = 'external_oidc'`),
  ],
);

export const sessions = identity.table(
  'sessions',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // SHA-256 of the 256-bit random token; the token itself is only ever in the cookie.
    tokenHash: bytea('token_hash').notNull().unique(),
    activeOrganisationId: uuid('active_organisation_id').references(() => organisations.id, {
      onDelete: 'set null',
    }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('sessions_active_by_user_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

export const OTP_CHANNELS = ['sms', 'email'] as const;
export const OTP_PURPOSES = ['login', 'verify_identifier'] as const;

export const otpChallenges = identity.table(
  'otp_challenges',
  {
    id: idColumn(),
    channel: text('channel', { enum: OTP_CHANNELS }).notNull(),
    // Destination is stored hashed; the plaintext phone/email lives only on the user row.
    destinationHash: bytea('destination_hash').notNull(),
    codeHash: bytea('code_hash').notNull(),
    purpose: text('purpose', { enum: OTP_PURPOSES }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    check('otp_challenges_channel_valid', oneOf(t.channel, OTP_CHANNELS)),
    check('otp_challenges_purpose_valid', oneOf(t.purpose, OTP_PURPOSES)),
    check('otp_challenges_attempts_range', sql`${t.attempts} between 0 and 10`),
    index('otp_challenges_destination_idx').on(t.destinationHash, t.createdAt),
  ],
);

/**
 * One-time setup links (ADR-019): until SMS is funded, a person gets access by opening a link
 * someone they know sent them (e.g. on WhatsApp) and choosing a password. Only an HMAC of the
 * token is stored; a link works once and expires. `organisation_id` is set when an organisation
 * created the link, so opening it also accepts that organisation's invitation.
 */
export const setupTokens = identity.table(
  'setup_tokens',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    organisationId: uuid('organisation_id').references(() => organisations.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [index('setup_tokens_user_idx').on(t.userId)],
);
