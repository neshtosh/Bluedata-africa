// Organisations (tenants) and everything that controls access to them. Every table here is
// protected by row-level security; child tables reference parents through composite foreign
// keys that include organisation_id, so a row cannot point at another tenant's data.
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  pgPolicy,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  citext,
  createdAt,
  idColumn,
  oneOf,
  tenantIsolationPolicy,
  updatedAt,
  version,
} from '../columns.js';
import { users } from './identity.js';
import { countries, currencies, organisationTypes, permissions, plans } from './ref.js';

export const tenancy = pgSchema('tenancy');

export const ORGANISATION_STATUSES = ['active', 'suspended', 'closed'] as const;

export const organisations = tenancy.table(
  'organisations',
  {
    id: idColumn(),
    legalName: text('legal_name').notNull(),
    tradingName: text('trading_name'),
    slug: citext('slug').notNull().unique(),
    countryCode: char('country_code', { length: 2 })
      .notNull()
      .references(() => countries.code),
    defaultCurrency: char('default_currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    timezone: text('timezone').notNull(),
    taxRegistrationNumber: text('tax_registration_number'),
    status: text('status', { enum: ORGANISATION_STATUSES }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    check('organisations_status_valid', oneOf(t.status, ORGANISATION_STATUSES)),
    check('organisations_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    // Visible inside its own tenant context, and to any user who is an active or invited
    // member (needed to list "my organisations" and pending invitations before choosing one).
    pgPolicy('organisations_read', {
      for: 'select',
      using: sql`${t.id} = app.current_org_id() or app.is_member(${t.id})`,
    }),
    // Any authenticated caller may register a new organisation.
    pgPolicy('organisations_create', {
      for: 'insert',
      withCheck: sql`app.current_user_id() is not null`,
    }),
    pgPolicy('organisations_update', {
      for: 'update',
      using: sql`${t.id} = app.current_org_id()`,
      withCheck: sql`${t.id} = app.current_org_id()`,
    }),
    // No delete policy: organisations are closed (status), never deleted.
  ],
);

export const organisationTypeAssignments = tenancy.table(
  'organisation_type_assignments',
  {
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id, { onDelete: 'cascade' }),
    typeCode: text('type_code')
      .notNull()
      .references(() => organisationTypes.code),
  },
  (t) => [
    primaryKey({ columns: [t.organisationId, t.typeCode] }),
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const branches = tenancy.table(
  'branches',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    name: text('name').notNull(),
    code: text('code'),
    isActive: boolean('is_active').notNull().default(true),
    // site_id (geo.sites) is added with the geo schema in Phase 3/4.
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('branches_org_id_key').on(t.organisationId, t.id),
    unique('branches_org_name_key').on(t.organisationId, t.name),
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const MEMBERSHIP_STATUSES = ['invited', 'active', 'suspended', 'removed'] as const;

export const memberships = tenancy.table(
  'memberships',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: text('status', { enum: MEMBERSHIP_STATUSES }).notNull().default('invited'),
    invitedBy: uuid('invited_by').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('memberships_status_valid', oneOf(t.status, MEMBERSHIP_STATUSES)),
    unique('memberships_org_user_key').on(t.organisationId, t.userId),
    unique('memberships_org_id_key').on(t.organisationId, t.id),
    index('memberships_user_idx').on(t.userId),
    // A user can always see their own memberships (to pick an organisation);
    // everything else requires the tenant context.
    pgPolicy('memberships_read', {
      for: 'select',
      using: sql`${t.organisationId} = app.current_org_id() or ${t.userId} = app.current_user_id()`,
    }),
    pgPolicy('memberships_write', {
      for: 'all',
      using: sql`${t.organisationId} = app.current_org_id()`,
      withCheck: sql`${t.organisationId} = app.current_org_id()`,
    }),
  ],
);

export const roles = tenancy.table(
  'roles',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    key: text('key').notNull(), // owner, admin, procurement_officer, …
    name: text('name').notNull(),
    description: text('description'),
    // True when copied from a platform role template; such roles cannot be deleted.
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('roles_org_key_key').on(t.organisationId, t.key),
    unique('roles_org_id_key').on(t.organisationId, t.id),
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const rolePermissions = tenancy.table(
  'role_permissions',
  {
    organisationId: uuid('organisation_id').notNull(),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionKey] }),
    foreignKey({
      name: 'role_permissions_role_fk',
      columns: [t.organisationId, t.roleId],
      foreignColumns: [roles.organisationId, roles.id],
    }).onDelete('cascade'),
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const membershipRoles = tenancy.table(
  'membership_roles',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id').notNull(),
    // Null = role applies across the whole organisation; otherwise only at this branch.
    branchId: uuid('branch_id'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('membership_roles_assignment_key')
      .on(t.membershipId, t.roleId, t.branchId)
      .nullsNotDistinct(),
    foreignKey({
      name: 'membership_roles_membership_fk',
      columns: [t.organisationId, t.membershipId],
      foreignColumns: [memberships.organisationId, memberships.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'membership_roles_role_fk',
      columns: [t.organisationId, t.roleId],
      foreignColumns: [roles.organisationId, roles.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'membership_roles_branch_fk',
      columns: [t.organisationId, t.branchId],
      foreignColumns: [branches.organisationId, branches.id],
    }),
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;

export const subscriptions = tenancy.table(
  'subscriptions',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    planCode: text('plan_code')
      .notNull()
      .references(() => plans.code),
    // Denormalised from the plan so the overlap exclusion constraint can use it.
    productCode: text('product_code').notNull(),
    status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('subscriptions_status_valid', oneOf(t.status, SUBSCRIPTION_STATUSES)),
    check('subscriptions_period_valid', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    // The no-overlapping-subscriptions EXCLUDE constraint is in the custom SQL migration.
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const dataSharingAgreements = tenancy.table(
  'data_sharing_agreements',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    scope: text('scope').notNull(), // price_contribution, volume_contribution, …
    granularity: text('granularity').notNull(), // daily_site, weekly_admin_area, …
    termsVersion: text('terms_version').notNull(),
    consentedBy: uuid('consented_by')
      .notNull()
      .references(() => users.id),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('data_sharing_agreements_active_idx')
      .on(t.organisationId, t.scope)
      .where(sql`${t.revokedAt} is null`),
    tenantIsolationPolicy(t.organisationId),
  ],
);
