// Rules shared by every SamakiOS document that records fish and money (supply, purchases, and
// later sales): converting entered quantities to kilograms, parsing prices in the right
// currency precision, and "today" in the organisation's own timezone.
import type { catalogueItems } from '@blue/database';
import {
  catalogueItemUnits,
  countries,
  currencies,
  organisations,
  type Transaction,
} from '@blue/database';
import { formatMinor, toKilograms, toMinor } from '@blue/primitives';
import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '../../kernel/errors/app-error.js';

/** What a trading document needs to know about its organisation. */
export interface OrgSettings {
  currency: string;
  /** Today's date where the organisation is (its country's timezone), YYYY-MM-DD. */
  today: string;
  minorUnits: Map<string, number>;
}

export async function orgSettings(tx: Transaction): Promise<OrgSettings> {
  const [org] = await tx
    .select({ currency: organisations.defaultCurrency, timezone: countries.defaultTimezone })
    .from(organisations)
    .innerJoin(countries, eq(countries.code, organisations.countryCode))
    .where(eq(organisations.id, sql`app.current_org_id()`));
  if (!org) throw new Error('organisation not visible in its own tenant context');
  const rows = await tx
    .select({ code: currencies.code, minorUnits: currencies.minorUnits })
    .from(currencies);
  return {
    currency: org.currency,
    today: todayIn(org.timezone),
    minorUnits: new Map(rows.map((r) => [r.code, r.minorUnits])),
  };
}

/** YYYY-MM-DD in an IANA timezone ("en-CA" formats dates that way). */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A field path, optionally under a prefix: ('lines.2', 'unitCode') → 'lines.2.unitCode'. */
const at = (prefix: string, field: string) => (prefix ? `${prefix}.${field}` : field);

/**
 * Quantity in kg via the unit's fixed factor (kg, g, t) or the organisation's own weight for
 * this item (ADR-017). Refuses units with no weight rather than guessing one.
 */
export async function kilograms(
  tx: Transaction,
  knownUnits: { code: string; kgFactor: string | null }[],
  item: typeof catalogueItems.$inferSelect,
  unitCode: string,
  quantity: string,
  pathPrefix = '',
): Promise<string> {
  const unit = knownUnits.find((u) => u.code === unitCode);
  if (!unit) {
    throw AppError.validation([
      { path: at(pathPrefix, 'unitCode'), code: 'unknown', message: `Unknown unit "${unitCode}"` },
    ]);
  }
  let kgPerUnit = unit.kgFactor;
  if (kgPerUnit === null) {
    const [own] = await tx
      .select()
      .from(catalogueItemUnits)
      .where(
        and(
          eq(catalogueItemUnits.catalogueItemId, item.id),
          eq(catalogueItemUnits.unitCode, unitCode),
        ),
      );
    kgPerUnit = own?.kgPerUnit ?? null;
  }
  if (kgPerUnit === null) {
    throw AppError.validation([
      {
        path: at(pathPrefix, 'unitCode'),
        code: 'no_weight',
        message: `Record how many kg a ${unit.code} of ${item.name} weighs in the catalogue first`,
      },
    ]);
  }
  const kg = toKilograms(quantity, kgPerUnit);
  if (!/[1-9]/.test(kg)) {
    throw AppError.validation([
      {
        path: at(pathPrefix, 'quantity'),
        code: 'too_small',
        message: 'Less than 1 gram; check the quantity',
      },
    ]);
  }
  return kg;
}

/** Parses a typed amount into minor units, refusing more decimals than the currency has. */
export function priceToMinor(
  amount: string,
  currency: string,
  settings: OrgSettings,
  path: string,
): bigint {
  const minorUnits = minorUnitsOf(currency, settings);
  try {
    return toMinor(amount, minorUnits);
  } catch {
    throw AppError.validation([
      {
        path,
        code: 'too_precise',
        message:
          minorUnits === 0
            ? `${currency} amounts have no decimals`
            : `${currency} amounts have at most ${minorUnits} decimals`,
      },
    ]);
  }
}

export function minorUnitsOf(currency: string, settings: OrgSettings): number {
  const units = settings.minorUnits.get(currency);
  if (units === undefined) throw new Error(`currency ${currency} is not in ref.currencies`);
  return units;
}

/** Formats minor units for the API: 150050n KES → "1500.50", 3500n UGX → "3500". */
export function formatMoney(amountMinor: bigint, currency: string, settings: OrgSettings): string {
  return formatMinor(amountMinor, minorUnitsOf(currency, settings));
}
