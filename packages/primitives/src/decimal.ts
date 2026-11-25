/**
 * Exact fixed-point decimals as scaled BigInts (ADR-008: no floating point for quantities or
 * money). A Fixed is an integer count of 10^-scale units: 12.5 kg at scale 3 is 12500n.
 * Values cross the API as decimal strings ("12.500"), never as JSON numbers.
 */
export interface Fixed {
  readonly units: bigint;
  readonly scale: number;
}

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** Parses "12.5" at a scale. Rejects input with more decimals than the scale (no silent rounding). */
export function parseFixed(text: string, scale: number): Fixed {
  const match = DECIMAL.exec(text.trim());
  if (!match) throw new RangeError(`Not a decimal number: "${text}"`);
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > scale) {
    throw new RangeError(`"${text}" has more than ${scale} decimal places`);
  }
  const units = BigInt(whole + fraction.padEnd(scale, '0'));
  return { units: sign ? -units : units, scale };
}

export function formatFixed({ units, scale }: Fixed): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(-scale)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/** Changes scale, rounding half away from zero when reducing precision. */
export function rescale(value: Fixed, scale: number): Fixed {
  if (scale === value.scale) return value;
  if (scale > value.scale)
    return { units: value.units * 10n ** BigInt(scale - value.scale), scale };
  const divisor = 10n ** BigInt(value.scale - scale);
  const negative = value.units < 0n;
  const magnitude = negative ? -value.units : value.units;
  const rounded = (magnitude + divisor / 2n) / divisor;
  return { units: negative ? -rounded : rounded, scale };
}

/** Exact product, then rounded to `scale`. */
export function multiply(a: Fixed, b: Fixed, scale: number): Fixed {
  return rescale({ units: a.units * b.units, scale: a.scale + b.scale }, scale);
}

export function add(a: Fixed, b: Fixed): Fixed {
  const scale = Math.max(a.scale, b.scale);
  return { units: rescale(a, scale).units + rescale(b, scale).units, scale };
}

export function isPositive(value: Fixed): boolean {
  return value.units > 0n;
}
