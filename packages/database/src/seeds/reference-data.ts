// Reference data present in every environment (DATABASE.md §6). Idempotent: safe to re-run on
// each deploy; existing rows are updated in place. Demo/sample tenant data never goes here.
import { sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { ORGANISATION_TYPES as CONTRACT_ORGANISATION_TYPES, PERMISSIONS } from '@blue/contracts';
import { newId } from '@blue/primitives';
import {
  countries,
  currencies,
  organisationTypes,
  permissions,
  plans,
  productForms,
  products,
  species,
  speciesNames,
  units,
} from '../schema/index.js';
import { PRODUCT_FORMS, SPECIES, UNITS } from './fisheries.js';

export const CURRENCIES = [
  { code: 'KES', name: 'Kenyan shilling', minorUnits: 2 },
  { code: 'UGX', name: 'Ugandan shilling', minorUnits: 0 },
  { code: 'TZS', name: 'Tanzanian shilling', minorUnits: 2 },
  { code: 'RWF', name: 'Rwandan franc', minorUnits: 0 },
  { code: 'USD', name: 'US dollar', minorUnits: 2 },
  { code: 'EUR', name: 'Euro', minorUnits: 2 },
] as const;

// Rwanda is seeded but inactive: its data-protection law restricts storing personal data
// outside Rwanda without authorisation, so sign-ups wait for the legal/residency review.
export const COUNTRIES = [
  {
    code: 'KE',
    name: 'Kenya',
    defaultCurrency: 'KES',
    defaultTimezone: 'Africa/Nairobi',
    isActive: true,
  },
  {
    code: 'UG',
    name: 'Uganda',
    defaultCurrency: 'UGX',
    defaultTimezone: 'Africa/Kampala',
    isActive: true,
  },
  {
    code: 'TZ',
    name: 'Tanzania',
    defaultCurrency: 'TZS',
    defaultTimezone: 'Africa/Dar_es_Salaam',
    isActive: true,
  },
  {
    code: 'RW',
    name: 'Rwanda',
    defaultCurrency: 'RWF',
    defaultTimezone: 'Africa/Kigali',
    isActive: false,
  },
] as const;

// Organisation types live in @blue/contracts (shared with the registration form).
export const ORGANISATION_TYPES = CONTRACT_ORGANISATION_TYPES;

export const PRODUCTS = [
  { code: 'samakios', name: 'SamakiOS' },
  { code: 'bluedata', name: 'BlueData Africa' },
] as const;

// Placeholder plans for the pilot only — commercial plans wait for the pricing decision.
export const PLANS = [
  { code: 'samakios_pilot', productCode: 'samakios', name: 'SamakiOS pilot', isActive: true },
  { code: 'bluedata_pilot', productCode: 'bluedata', name: 'BlueData pilot', isActive: true },
] as const;

export async function seedReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(currencies)
      .values([...CURRENCIES])
      .onConflictDoUpdate({
        target: currencies.code,
        set: { name: sql`excluded.name`, minorUnits: sql`excluded.minor_units` },
      });
    await tx
      .insert(countries)
      .values([...COUNTRIES])
      .onConflictDoUpdate({
        target: countries.code,
        set: {
          name: sql`excluded.name`,
          defaultCurrency: sql`excluded.default_currency`,
          defaultTimezone: sql`excluded.default_timezone`,
          isActive: sql`excluded.is_active`,
        },
      });
    await tx
      .insert(organisationTypes)
      .values([...ORGANISATION_TYPES])
      .onConflictDoUpdate({ target: organisationTypes.code, set: { name: sql`excluded.name` } });
    await tx
      .insert(products)
      .values([...PRODUCTS])
      .onConflictDoUpdate({ target: products.code, set: { name: sql`excluded.name` } });
    await tx
      .insert(plans)
      .values([...PLANS])
      .onConflictDoUpdate({
        target: plans.code,
        set: {
          productCode: sql`excluded.product_code`,
          name: sql`excluded.name`,
          isActive: sql`excluded.is_active`,
        },
      });
    // From the code registry (ARCHITECTURE.md §10.3). Keys removed from the registry are not
    // deleted here, because roles may still reference them; retire them with a migration.
    await tx
      .insert(permissions)
      .values(
        Object.entries(PERMISSIONS).map(([key, permission]) => ({
          key,
          productCode: permission.product,
          description: permission.description,
        })),
      )
      .onConflictDoUpdate({
        target: permissions.key,
        set: { productCode: sql`excluded.product_code`, description: sql`excluded.description` },
      });

    // Fisheries vocabulary (seeds/fisheries.ts).
    await tx
      .insert(productForms)
      .values([...PRODUCT_FORMS])
      .onConflictDoUpdate({ target: productForms.code, set: { name: sql`excluded.name` } });
    await tx
      .insert(units)
      .values(UNITS.map((u) => ({ ...u })))
      .onConflictDoUpdate({
        target: units.code,
        set: {
          name: sql`excluded.name`,
          dimension: sql`excluded.dimension`,
          kgFactor: sql`excluded.kg_factor`,
        },
      });
    for (const { names, ...row } of SPECIES) {
      const [saved] = await tx
        .insert(species)
        .values({ id: newId(), ...row })
        .onConflictDoUpdate({
          target: species.scientificName,
          set: {
            commonNameEn: sql`excluded.common_name_en`,
            family: sql`excluded.family`,
            habitat: sql`excluded.habitat`,
            farmed: sql`excluded.farmed`,
          },
        })
        .returning({ id: species.id });
      if (!saved) throw new Error(`species upsert returned no row: ${row.scientificName}`);
      // Additive: names added later by data stewards are never removed by the seed.
      await tx
        .insert(speciesNames)
        .values(names.map((n) => ({ speciesId: saved.id, ...n })))
        .onConflictDoNothing();
    }
  });
}
