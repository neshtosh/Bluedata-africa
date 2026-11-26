// Display helpers for decimal strings from the API. Values arrive as exact decimal strings
// (ADR-008); these never round stored values, they only format or preview them.

/** "12500.5" → "12,500.5". */
export function grouped(value: string): string {
  const negative = value.startsWith('-');
  const [whole = '0', fraction] = (negative ? value.slice(1) : value).split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${fraction ? `${withCommas}.${fraction}` : withCommas}`;
}

/** Parses a typed decimal into an integer at `scale` places; null if it isn't one. */
export function toScaled(text: string, scale: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim().replace(/,/g, ''));
  if (!match) return null;
  const [, whole = '0', fraction = ''] = match;
  if (fraction.length > scale) return null;
  return BigInt(whole + fraction.padEnd(scale, '0'));
}

/** Formats an integer at `scale` places, dropping trailing zeros when `trim` is set. */
export function fromScaled(units: bigint, scale: number, trim = false): string {
  const digits = units.toString().padStart(scale + 1, '0');
  const text = scale > 0 ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return trim && scale > 0 ? text.replace(/\.?0+$/, '') : text;
}

/** Adds kilogram strings exactly (to the gram). */
export function sumKg(values: string[]): string {
  const grams = values.reduce((total, value) => total + (toScaled(value, 3) ?? 0n), 0n);
  return fromScaled(grams, 3, true);
}

/**
 * Decimal places of a currency, for previews only (the server checks and computes the real
 * figures from ref.currencies): Uganda and Rwanda shillings/francs have none.
 */
export function minorUnits(currency: string): number {
  return currency === 'UGX' || currency === 'RWF' ? 0 : 2;
}

/** Quantity × unit price, rounded to the currency's minor unit as the server does. */
export function previewLineTotal(quantity: string, unitPrice: string, currency: string) {
  const scale = minorUnits(currency);
  const milli = toScaled(quantity, 3);
  const price = toScaled(unitPrice, scale);
  if (milli === null || price === null) return null;
  return (milli * price + 500n) / 1000n;
}

/** Today's date on this device, YYYY-MM-DD (a form default; the server checks dates). */
export function todayLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
