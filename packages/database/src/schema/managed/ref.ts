// Global, curated reference data. Read-only for the runtime role; written only by seeds and
// data stewards. Never tenant-scoped.
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, oneOf } from '../columns.js';

export const ref = pgSchema('ref');

export const currencies = ref.table(
  'currencies',
  {
    code: char('code', { length: 3 }).primaryKey(), // ISO 4217
    name: text('name').notNull(),
    // Exponent used for amount_minor columns: KES/TZS = 2, UGX/RWF = 0 (ADR-008).
    minorUnits: smallint('minor_units').notNull(),
  },
  (t) => [
    check('currencies_code_format', sql`${t.code} ~ '^[A-Z]{3}$'`),
    check('currencies_minor_units_range', sql`${t.minorUnits} between 0 and 4`),
  ],
);

export const countries = ref.table(
  'countries',
  {
    code: char('code', { length: 2 }).primaryKey(), // ISO 3166-1 alpha-2
    name: text('name').notNull(),
    defaultCurrency: char('default_currency', { length: 3 })
      .notNull()
      .references(() => currencies.code),
    defaultTimezone: text('default_timezone').notNull(), // IANA zone, e.g. Africa/Nairobi
    // Whether the platform operates in this country yet (sign-ups, data processing).
    isActive: boolean('is_active').notNull().default(false),
  },
  (t) => [check('countries_code_format', sql`${t.code} ~ '^[A-Z]{2}$'`)],
);

export const organisationTypes = ref.table('organisation_types', {
  code: text('code').primaryKey(), // trader_aggregator, processor, bmu, …
  name: text('name').notNull(),
});

/** Products on the platform (samakios, bluedata, later fishconnect, …). */
export const products = ref.table('products', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
});

export const plans = ref.table('plans', {
  code: text('code').primaryKey(),
  productCode: text('product_code')
    .notNull()
    .references(() => products.code),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

/**
 * Permission keys (e.g. samakios.purchases.create). Seeded from the code registry on deploy so
 * roles can only reference permissions that exist (ARCHITECTURE.md §10.3).
 */
export const permissions = ref.table(
  'permissions',
  {
    key: text('key').primaryKey(),
    // Null for platform-wide permissions (members, roles, billing).
    productCode: text('product_code').references(() => products.code),
    description: text('description').notNull(),
  },
  (t) => [check('permissions_key_format', sql`${t.key} ~ '^[a-z_]+(\\.[a-z_]+)+$'`)],
);

// --- Fisheries vocabulary (DATABASE.md §3.3) ---

export const HABITATS = ['freshwater', 'marine', 'brackish'] as const;

/** Species, keyed by scientific name. Local names differ by country and language (species_names). */
export const species = ref.table(
  'species',
  {
    id: idColumn(),
    scientificName: text('scientific_name').notNull().unique(),
    commonNameEn: text('common_name_en').notNull(),
    family: text('family'),
    habitat: text('habitat', { enum: HABITATS }).notNull(),
    /** Commonly farmed in the region (aquaculture), not only wild-caught. */
    farmed: boolean('farmed').notNull().default(false),
  },
  (t) => [check('species_habitat_valid', oneOf(t.habitat, HABITATS))],
);

export const speciesNames = ref.table(
  'species_names',
  {
    speciesId: uuid('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'cascade' }),
    /** ISO 639 code: sw (Swahili), luo (Dholuo), lg (Luganda), en … */
    language: text('language').notNull(),
    /** Where this name is used, if specific to a country. */
    countryCode: char('country_code', { length: 2 }).references(() => countries.code),
    name: text('name').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.speciesId, t.language, t.name] }),
    index('species_names_name_idx').on(t.name),
  ],
);

/** How the fish is sold: fresh whole, fillet, sun-dried, smoked, maw … Price depends on it. */
export const productForms = ref.table('product_forms', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
});

export const UNIT_DIMENSIONS = ['mass', 'count', 'container'] as const;

/**
 * Units of measure. Mass units have a fixed kg factor. Count and container units (piece, basin,
 * tin, crate …) have none: their weight depends on the species and the trader, so each
 * organisation records it per catalogue item (ops.catalogue_item_units). See ADR-008.
 */
export const units = ref.table(
  'units',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    dimension: text('dimension', { enum: UNIT_DIMENSIONS }).notNull(),
    kgFactor: numeric('kg_factor', { precision: 12, scale: 6 }),
  },
  (t) => [
    check('units_dimension_valid', oneOf(t.dimension, UNIT_DIMENSIONS)),
    check('units_mass_has_factor', sql`(${t.dimension} = 'mass') = (${t.kgFactor} is not null)`),
  ],
);
