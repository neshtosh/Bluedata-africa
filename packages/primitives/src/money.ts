import { formatFixed, multiply, parseFixed } from './decimal.js';
import { QUANTITY_SCALE } from './quantity.js';

/**
 * Money is an integer count of the currency's minor units plus an ISO 4217 code (ADR-008).
 * Minor units per currency come from ref.currencies: KES/TZS 2, UGX/RWF 0.
 * `amountMinor` crosses the API as a string so large values survive JavaScript numbers.
 */
export interface Money {
  amountMinor: bigint;
  currency: string;
}

/** Line total = quantity × unit price, rounded half away from zero to a whole minor unit. */
export function lineTotal(quantity: string, unitPriceMinor: bigint): bigint {
  return multiply(parseFixed(quantity, QUANTITY_SCALE), { units: unitPriceMinor, scale: 0 }, 0)
    .units;
}

/** For display only: 150000n KES (2 decimals) → "1500.00". Formatting with symbols is the UI's job. */
export function formatMinor(amountMinor: bigint, minorUnits: number): string {
  return formatFixed({ units: amountMinor, scale: minorUnits });
}

/** Parses a major-unit amount typed by a user ("1500.5") into minor units for a currency. */
export function toMinor(amount: string, minorUnits: number): bigint {
  return parseFixed(amount, minorUnits).units;
}
