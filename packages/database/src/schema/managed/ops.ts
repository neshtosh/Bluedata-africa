// SamakiOS operational data (DATABASE.md §3.5). Every table is tenant-owned: organisation_id on
// every row, RLS on every table, composite foreign keys so rows can't reference another tenant.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  createdAt,
  idColumn,
  oneOf,
  tenantIsolationPolicy,
  updatedAt,
  version,
} from '../columns.js';
import { currencies, productForms, species, units } from './ref.js';
import { organisations } from './tenancy.js';

export const ops = pgSchema('ops');

/**
 * What an organisation buys and sells: species × product form × (grade, size class).
 * E.g. "Nile perch, fresh whole, grade A, 3–5 kg" or "Omena, sun-dried".
 */
export const catalogueItems = ops.table(
  'catalogue_items',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    /** Display name used on documents, e.g. "Omena — sun-dried". */
    name: text('name').notNull(),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id),
    productFormCode: text('product_form_code')
      .notNull()
      .references(() => productForms.code),
    grade: text('grade'),
    sizeClass: text('size_class'),
    /** Unit pre-selected when recording purchases and sales of this item. */
    defaultUnitCode: text('default_unit_code')
      .notNull()
      .references(() => units.code),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('catalogue_items_org_id_key').on(t.organisationId, t.id),
    // The same item can't be listed twice (null grade/size count as equal).
    unique('catalogue_items_identity_key')
      .on(t.organisationId, t.speciesId, t.productFormCode, t.grade, t.sizeClass)
      .nullsNotDistinct(),
    index('catalogue_items_org_species_idx').on(t.organisationId, t.speciesId),
    tenantIsolationPolicy(t.organisationId),
  ],
);

/**
 * The organisation's own weight for a count or container unit of an item — e.g. "our basin of
 * omena ≈ 18.5 kg". Mass units (kg, g, t) never appear here: their factor is fixed.
 */
export const catalogueItemUnits = ops.table(
  'catalogue_item_units',
  {
    organisationId: uuid('organisation_id').notNull(),
    catalogueItemId: uuid('catalogue_item_id').notNull(),
    unitCode: text('unit_code')
      .notNull()
      .references(() => units.code),
    kgPerUnit: numeric('kg_per_unit', { precision: 12, scale: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.catalogueItemId, t.unitCode] }),
    foreignKey({
      name: 'catalogue_item_units_item_fk',
      columns: [t.organisationId, t.catalogueItemId],
      foreignColumns: [catalogueItems.organisationId, catalogueItems.id],
    }).onDelete('cascade'),
    check('catalogue_item_units_positive', sql`${t.kgPerUnit} > 0`),
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const PARTNER_KINDS = ['individual', 'business', 'cooperative', 'bmu'] as const;
export const PRODUCTION_TYPES = ['wild', 'farmed', 'both'] as const;

/**
 * The people and businesses an organisation trades with (DATABASE.md §3.5). One table for
 * suppliers, buyers and transporters, because the same party often plays several roles.
 * Records are private to the organisation; they are never merged across tenants.
 * Personal data is kept minimal (name, phone): partners are data subjects who did not sign up.
 */
export const tradingPartners = ops.table(
  'trading_partners',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    kind: text('kind', { enum: PARTNER_KINDS }).notNull(),
    name: text('name').notNull(),
    phoneE164: text('phone_e164'),
    isSupplier: boolean('is_supplier').notNull().default(false),
    isBuyer: boolean('is_buyer').notNull().default(false),
    isTransporter: boolean('is_transporter').notNull().default(false),
    /** For suppliers: wild-caught, farmed, or both. */
    productionType: text('production_type', { enum: PRODUCTION_TYPES }),
    /** Home landing site or location, free text until the geographic registry (Phase 4). */
    landingSite: text('landing_site'),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    check('trading_partners_kind_valid', oneOf(t.kind, PARTNER_KINDS)),
    check(
      'trading_partners_production_type_valid',
      sql`${t.productionType} is null or ${oneOf(t.productionType, PRODUCTION_TYPES)}`,
    ),
    check('trading_partners_phone_format', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('trading_partners_has_role', sql`${t.isSupplier} or ${t.isBuyer} or ${t.isTransporter}`),
    unique('trading_partners_org_id_key').on(t.organisationId, t.id),
    // One record per phone number within an organisation (helps avoid duplicate partners).
    uniqueIndex('trading_partners_org_phone_key')
      .on(t.organisationId, t.phoneE164)
      .where(sql`${t.phoneE164} is not null`),
    index('trading_partners_org_name_idx').on(t.organisationId, t.name),
    tenantIsolationPolicy(t.organisationId),
  ],
);

/** Species a partner supplies or buys, for filtering ("who sells Nile perch?"). */
export const partnerSpecies = ops.table(
  'partner_species',
  {
    organisationId: uuid('organisation_id').notNull(),
    partnerId: uuid('partner_id').notNull(),
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id),
  },
  (t) => [
    primaryKey({ columns: [t.partnerId, t.speciesId] }),
    foreignKey({
      name: 'partner_species_partner_fk',
      columns: [t.organisationId, t.partnerId],
      foreignColumns: [tradingPartners.organisationId, tradingPartners.id],
    }).onDelete('cascade'),
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const SUPPLY_ORIGINS = ['wild', 'farmed'] as const;
/**
 * `purchased` is set only by purchases (3.4). "Expired" is not stored: an available or reserved
 * record whose `available_until` has passed is shown as expired, so no scheduled job is needed.
 */
export const SUPPLY_STATUSES = ['available', 'reserved', 'purchased', 'withdrawn'] as const;

/**
 * Fish a supplier has, or expects to have (DATABASE.md §3.5): "record fish availability" for
 * wild landings and farm harvests. Quantity is kept as entered (2 basins) and in kilograms,
 * converted with the organisation's unit weights at the time it was recorded (ADR-017).
 * Location is free text until the geographic registry (Phase 4) adds `site_id`.
 */
export const supplyRecords = ops.table(
  'supply_records',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    partnerId: uuid('partner_id').notNull(),
    catalogueItemId: uuid('catalogue_item_id').notNull(),
    origin: text('origin', { enum: SUPPLY_ORIGINS }).notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitCode: text('unit_code')
      .notNull()
      .references(() => units.code),
    quantityKg: numeric('quantity_kg', { precision: 14, scale: 3 }).notNull(),
    /** Landing or harvest date, or the date the fish is expected. */
    availableFrom: date('available_from').notNull(),
    availableUntil: date('available_until'),
    /** Asking price per `unit_code`, in minor units of `currency`. */
    askingPriceMinor: bigint('asking_price_minor', { mode: 'bigint' }),
    currency: char('currency', { length: 3 }).references(() => currencies.code),
    location: text('location'),
    notes: text('notes'),
    status: text('status', { enum: SUPPLY_STATUSES }).notNull().default('available'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('supply_records_org_id_key').on(t.organisationId, t.id),
    foreignKey({
      name: 'supply_records_partner_fk',
      columns: [t.organisationId, t.partnerId],
      foreignColumns: [tradingPartners.organisationId, tradingPartners.id],
    }),
    foreignKey({
      name: 'supply_records_item_fk',
      columns: [t.organisationId, t.catalogueItemId],
      foreignColumns: [catalogueItems.organisationId, catalogueItems.id],
    }),
    check('supply_records_origin_valid', oneOf(t.origin, SUPPLY_ORIGINS)),
    check('supply_records_status_valid', oneOf(t.status, SUPPLY_STATUSES)),
    check('supply_records_quantity_positive', sql`${t.quantity} > 0 and ${t.quantityKg} > 0`),
    check(
      'supply_records_dates_ordered',
      sql`${t.availableUntil} is null or ${t.availableUntil} >= ${t.availableFrom}`,
    ),
    check(
      'supply_records_price_has_currency',
      sql`(${t.askingPriceMinor} is null) = (${t.currency} is null) and (${t.askingPriceMinor} is null or ${t.askingPriceMinor} >= 0)`,
    ),
    index('supply_records_org_status_idx').on(t.organisationId, t.status, t.availableFrom),
    index('supply_records_org_partner_idx').on(t.organisationId, t.partnerId),
    index('supply_records_org_item_idx').on(t.organisationId, t.catalogueItemId),
    tenantIsolationPolicy(t.organisationId),
  ],
);
