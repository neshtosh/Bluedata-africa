import { formatFixed, multiply, parseFixed } from './decimal.js';

/** Kilograms are stored to the gram (numeric(14,3)). */
export const KG_SCALE = 3;
/** Quantities as entered (e.g. 2.5 basins), same precision. */
export const QUANTITY_SCALE = 3;
/** Conversion factors (kg per unit), numeric(12,6). */
export const FACTOR_SCALE = 6;

/** Fixed kilogram factors for mass units. Container and count units have none (ADR-008). */
export const MASS_UNIT_KG: Readonly<Record<string, string>> = { kg: '1', g: '0.001', t: '1000' };

/**
 * Converts an entered quantity to kilograms: `quantity × kgPerUnit`, rounded to the gram.
 * Decimal strings in and out, exact arithmetic in between.
 */
export function toKilograms(quantity: string, kgPerUnit: string): string {
  const kg = multiply(
    parseFixed(quantity, QUANTITY_SCALE),
    parseFixed(kgPerUnit, FACTOR_SCALE),
    KG_SCALE,
  );
  return formatFixed(kg);
}
