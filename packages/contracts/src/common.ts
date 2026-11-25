import { z } from 'zod';

/** E.164 phone number, e.g. +254712345678 — the platform's primary identifier (phone-first). */
export const PhoneE164 = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, 'Use international format, e.g. +254712345678');

export const Uuid = z.uuid();

export const DisplayName = z.string().trim().min(1).max(120);

/** URL-safe organisation handle: lowercase letters, digits and single hyphens. */
export const Slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and hyphens')
  .min(3)
  .max(60);

export const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2, e.g. KE');
