import { describe, expect, it } from 'vitest';
import { add, formatFixed, multiply, parseFixed, rescale } from './decimal.js';
import { formatMinor, lineTotal, toMinor } from './money.js';
import { toKilograms } from './quantity.js';

describe('fixed-point decimals', () => {
  it('round-trips strings exactly', () => {
    for (const text of ['0.000', '12.500', '-3.250', '1000000.001']) {
      expect(formatFixed(parseFixed(text, 3))).toBe(text);
    }
    expect(formatFixed(parseFixed('12.5', 3))).toBe('12.500');
    expect(formatFixed(parseFixed('7', 0))).toBe('7');
  });

  it('refuses extra precision instead of silently rounding input', () => {
    expect(() => parseFixed('1.2345', 3)).toThrow(/more than 3 decimal places/);
    expect(() => parseFixed('1,5', 3)).toThrow(/Not a decimal/);
    expect(() => parseFixed('', 3)).toThrow();
  });

  it('rounds half away from zero when reducing precision', () => {
    expect(formatFixed(rescale(parseFixed('1.0005', 4), 3))).toBe('1.001');
    expect(formatFixed(rescale(parseFixed('1.0004', 4), 3))).toBe('1.000');
    expect(formatFixed(rescale(parseFixed('-1.0005', 4), 3))).toBe('-1.001');
  });

  it('is exact where floating point is not', () => {
    // 0.1 + 0.2 !== 0.3 in floating point.
    expect(formatFixed(add(parseFixed('0.1', 1), parseFixed('0.2', 1)))).toBe('0.3');
    expect(formatFixed(multiply(parseFixed('1.1', 1), parseFixed('1.1', 1), 2))).toBe('1.21');
  });
});

describe('quantities', () => {
  it('converts entered units to kilograms to the gram', () => {
    expect(toKilograms('4', '18.5')).toBe('74.000'); // 4 basins of 18.5 kg
    expect(toKilograms('2.5', '1')).toBe('2.500');
    expect(toKilograms('1500', '0.001')).toBe('1.500'); // grams
    expect(toKilograms('1.333', '0.333333')).toBe('0.444'); // 0.444333… rounds to 0.444
  });
});

describe('money', () => {
  it('computes line totals in whole minor units', () => {
    expect(lineTotal('4', 180_000n)).toBe(720_000n); // 4 × KES 1,800.00
    expect(lineTotal('2.5', 3333n)).toBe(8333n); // 8332.5 → 8333 (half away from zero)
    expect(lineTotal('0.001', 1n)).toBe(0n);
  });

  it('parses and formats amounts for currencies with different minor units', () => {
    expect(toMinor('1500.50', 2)).toBe(150_050n); // KES
    expect(toMinor('25000', 0)).toBe(25_000n); // UGX has no minor unit
    expect(() => toMinor('25000.5', 0)).toThrow(); // half a shilling is not a UGX amount
    expect(formatMinor(150_050n, 2)).toBe('1500.50');
    expect(formatMinor(25_000n, 0)).toBe('25000');
  });
});
