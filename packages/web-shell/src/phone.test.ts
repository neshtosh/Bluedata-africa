import { describe, expect, it } from 'vitest';
import { toE164 } from './phone.js';

describe('toE164', () => {
  it.each([
    ['0712 345 678', '+254712345678'],
    ['712345678', '+254712345678'],
    ['712-345-678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['00254712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    [' (0712) 345 678 ', '+254712345678'],
  ])('normalises Kenyan input %j', (typed, expected) => {
    expect(toE164('KE', typed)).toBe(expected);
  });

  it('uses the selected country code', () => {
    expect(toE164('UG', '0772 123 456')).toBe('+256772123456');
    expect(toE164('TZ', '754123456')).toBe('+255754123456');
    expect(toE164('RW', '0788123456')).toBe('+250788123456');
  });

  it('keeps an explicit international number even if another country is selected', () => {
    expect(toE164('KE', '+256772123456')).toBe('+256772123456');
  });

  it.each(['', '12345', '07123456789012', 'not a number', '0712 34a 678'])(
    'rejects %j',
    (typed) => {
      expect(toE164('KE', typed)).toBeNull();
    },
  );
});
