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
  integer,
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

export const PURCHASE_STATUSES = ['draft', 'confirmed', 'cancelled'] as const;

/**
 * A purchase from a supplier (DATABASE.md §3.5). Either planned (draft, confirmed when the fish
 * arrives) or a spot purchase at the landing site (confirmed at once). Confirming creates one
 * batch per line and receives it into stock in the same transaction. Confirmed purchases are
 * not edited; corrections come later as returns and stock adjustments.
 * `branch_id` and `payment_status` from the plan arrive with branches in the UI and with
 * payments (3.7); until then everything confirmed is owed in full.
 */
export const purchases = ops.table(
  'purchases',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    /** Per organisation and year, e.g. PO-2026-000042. */
    number: text('number').notNull(),
    partnerId: uuid('partner_id').notNull(),
    purchaseDate: date('purchase_date').notNull(),
    status: text('status', { enum: PURCHASE_STATUSES }).notNull().default('draft'),
    currency: char('currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    location: text('location'),
    notes: text('notes'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: version(),
  },
  (t) => [
    unique('purchases_org_id_key').on(t.organisationId, t.id),
    unique('purchases_org_number_key').on(t.organisationId, t.number),
    foreignKey({
      name: 'purchases_partner_fk',
      columns: [t.organisationId, t.partnerId],
      foreignColumns: [tradingPartners.organisationId, tradingPartners.id],
    }),
    check('purchases_status_valid', oneOf(t.status, PURCHASE_STATUSES)),
    check('purchases_total_not_negative', sql`${t.totalMinor} >= 0`),
    check(
      'purchases_status_timestamps',
      sql`(${t.status} = 'confirmed') = (${t.confirmedAt} is not null) and (${t.status} = 'cancelled') = (${t.cancelledAt} is not null)`,
    ),
    index('purchases_org_status_date_idx').on(t.organisationId, t.status, t.purchaseDate),
    index('purchases_org_partner_idx').on(t.organisationId, t.partnerId),
    tenantIsolationPolicy(t.organisationId),
  ],
);

/** What was bought: quantity as entered and in kg, price per entered unit, exact line total. */
export const purchaseLines = ops.table(
  'purchase_lines',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id').notNull(),
    purchaseId: uuid('purchase_id').notNull(),
    lineNo: integer('line_no').notNull(),
    catalogueItemId: uuid('catalogue_item_id').notNull(),
    /** The supplier's offer this line takes up, if any. */
    supplyRecordId: uuid('supply_record_id'),
    origin: text('origin', { enum: SUPPLY_ORIGINS }).notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitCode: text('unit_code')
      .notNull()
      .references(() => units.code),
    quantityKg: numeric('quantity_kg', { precision: 14, scale: 3 }).notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'bigint' }).notNull(),
    lineTotalMinor: bigint('line_total_minor', { mode: 'bigint' }).notNull(),
  },
  (t) => [
    unique('purchase_lines_org_id_key').on(t.organisationId, t.id),
    unique('purchase_lines_purchase_line_no_key').on(t.purchaseId, t.lineNo),
    foreignKey({
      name: 'purchase_lines_purchase_fk',
      columns: [t.organisationId, t.purchaseId],
      foreignColumns: [purchases.organisationId, purchases.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'purchase_lines_item_fk',
      columns: [t.organisationId, t.catalogueItemId],
      foreignColumns: [catalogueItems.organisationId, catalogueItems.id],
    }),
    foreignKey({
      name: 'purchase_lines_supply_fk',
      columns: [t.organisationId, t.supplyRecordId],
      foreignColumns: [supplyRecords.organisationId, supplyRecords.id],
    }),
    check('purchase_lines_origin_valid', oneOf(t.origin, SUPPLY_ORIGINS)),
    check('purchase_lines_quantity_positive', sql`${t.quantity} > 0 and ${t.quantityKg} > 0`),
    check(
      'purchase_lines_money_not_negative',
      sql`${t.unitPriceMinor} >= 0 and ${t.lineTotalMinor} >= 0`,
    ),
    index('purchase_lines_org_supply_idx').on(t.organisationId, t.supplyRecordId),
    tenantIsolationPolicy(t.organisationId),
  ],
);

/**
 * A traceable lot of fish in stock: where it came from, when, from whom, at what cost.
 * Created when a purchase line is received; later also from own catch and processing.
 * Cost per kg is derived (cost_minor / quantity_kg_received) rather than stored rounded.
 */
export const batches = ops.table(
  'batches',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id')
      .notNull()
      .references(() => organisations.id),
    /** Per organisation and year, e.g. B-2026-000107. */
    number: text('number').notNull(),
    catalogueItemId: uuid('catalogue_item_id').notNull(),
    origin: text('origin', { enum: SUPPLY_ORIGINS }).notNull(),
    supplierPartnerId: uuid('supplier_partner_id'),
    purchaseLineId: uuid('purchase_line_id'),
    /** Landing or harvest date when known (from the supply offer), else the purchase date. */
    catchOrHarvestDate: date('catch_or_harvest_date').notNull(),
    receivedOn: date('received_on').notNull(),
    quantityKgReceived: numeric('quantity_kg_received', { precision: 14, scale: 3 }).notNull(),
    costMinor: bigint('cost_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    createdAt: createdAt(),
  },
  (t) => [
    unique('batches_org_id_key').on(t.organisationId, t.id),
    unique('batches_org_number_key').on(t.organisationId, t.number),
    uniqueIndex('batches_purchase_line_key')
      .on(t.purchaseLineId)
      .where(sql`${t.purchaseLineId} is not null`),
    foreignKey({
      name: 'batches_item_fk',
      columns: [t.organisationId, t.catalogueItemId],
      foreignColumns: [catalogueItems.organisationId, catalogueItems.id],
    }),
    foreignKey({
      name: 'batches_supplier_fk',
      columns: [t.organisationId, t.supplierPartnerId],
      foreignColumns: [tradingPartners.organisationId, tradingPartners.id],
    }),
    foreignKey({
      name: 'batches_purchase_line_fk',
      columns: [t.organisationId, t.purchaseLineId],
      foreignColumns: [purchaseLines.organisationId, purchaseLines.id],
    }),
    check('batches_origin_valid', oneOf(t.origin, SUPPLY_ORIGINS)),
    check('batches_received_positive', sql`${t.quantityKgReceived} > 0 and ${t.costMinor} >= 0`),
    index('batches_org_item_idx').on(t.organisationId, t.catalogueItemId),
    tenantIsolationPolicy(t.organisationId),
  ],
);

export const MOVEMENT_TYPES = [
  'receipt',
  'sale_issue',
  'transfer_out',
  'transfer_in',
  'processing_in',
  'processing_out',
  'adjustment_gain',
  'adjustment_loss',
  'loss',
] as const;

/**
 * The stock ledger: every change to a batch's kilograms, signed (+ in, - out). Append-only:
 * the runtime role may insert and read but never update or delete (custom migration).
 */
export const inventoryMovements = ops.table(
  'inventory_movements',
  {
    id: idColumn(),
    organisationId: uuid('organisation_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    movementType: text('movement_type', { enum: MOVEMENT_TYPES }).notNull(),
    quantityKg: numeric('quantity_kg', { precision: 14, scale: 3 }).notNull(),
    /** The source document, e.g. ('purchase', purchase id). */
    referenceType: text('reference_type').notNull(),
    referenceId: uuid('reference_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'inventory_movements_batch_fk',
      columns: [t.organisationId, t.batchId],
      foreignColumns: [batches.organisationId, batches.id],
    }),
    check('inventory_movements_type_valid', oneOf(t.movementType, MOVEMENT_TYPES)),
    check('inventory_movements_not_zero', sql`${t.quantityKg} <> 0`),
    index('inventory_movements_org_batch_idx').on(t.organisationId, t.batchId),
    index('inventory_movements_org_time_idx').on(t.organisationId, t.occurredAt),
    tenantIsolationPolicy(t.organisationId),
  ],
);

/**
 * Kilograms on hand per batch, kept in step with the ledger in the same transaction.
 * The CHECK makes overselling impossible even under concurrency (rows are locked on change).
 * Storage locations arrive later; until then a batch has one balance.
 */
export const inventoryBalances = ops.table(
  'inventory_balances',
  {
    organisationId: uuid('organisation_id').notNull(),
    batchId: uuid('batch_id').primaryKey(),
    quantityKg: numeric('quantity_kg', { precision: 14, scale: 3 }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'inventory_balances_batch_fk',
      columns: [t.organisationId, t.batchId],
      foreignColumns: [batches.organisationId, batches.id],
    }),
    check('inventory_balances_not_negative', sql`${t.quantityKg} >= 0`),
    index('inventory_balances_org_idx').on(t.organisationId),
    tenantIsolationPolicy(t.organisationId),
  ],
);
