/** Dialling codes offered at sign-in. Sign-in works in all; organisation registration is
 * limited server-side to countries that are open (Rwanda pending the residency review). */
export const PHONE_COUNTRIES = [
  { code: 'KE', dial: '+254', example: '712 345 678' },
  { code: 'UG', dial: '+256', example: '772 123 456' },
  { code: 'TZ', dial: '+255', example: '754 123 456' },
  { code: 'RW', dial: '+250', example: '788 123 456' },
] as const;

export type PhoneCountryCode = (typeof PHONE_COUNTRIES)[number]['code'];

const E164 = /^\+[1-9][0-9]{6,14}$/;
/** KE, UG, TZ and RW all use 9-digit national (significant) numbers. */
const NATIONAL_DIGITS = 9;

/**
 * Turns what people actually type into E.164. For Kenya, "0712 345 678", "712-345-678",
 * "254712345678", "00254712345678" and "+254 712 345 678" all become "+254712345678".
 * An explicit international number (+… or 00…) is kept as typed. Returns null if invalid.
 */
export function toE164(country: PhoneCountryCode, typed: string): string | null {
  const dial = PHONE_COUNTRIES.find((c) => c.code === country)?.dial;
  if (!dial) return null;
  let digits = typed.trim().replace(/[\s().-]/g, '');

  if (digits.startsWith('+')) return E164.test(digits) ? digits : null;
  if (!/^[0-9]+$/.test(digits)) return null;
  if (digits.startsWith('00'))
    return E164.test(`+${digits.slice(2)}`) ? `+${digits.slice(2)}` : null;

  const countryDigits = dial.slice(1);
  if (
    digits.length === countryDigits.length + NATIONAL_DIGITS &&
    digits.startsWith(countryDigits)
  ) {
    return `+${digits}`;
  }
  if (digits.length === NATIONAL_DIGITS + 1 && digits.startsWith('0')) digits = digits.slice(1); // trunk 0
  return digits.length === NATIONAL_DIGITS ? `${dial}${digits}` : null;
}
