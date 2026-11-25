import { z } from 'zod';
import { PhoneE164, Uuid } from './common.js';

export const PARTNER_KINDS = ['individual', 'business', 'cooperative', 'bmu'] as const;
export const PARTNER_ROLES = ['supplier', 'buyer', 'transporter'] as const;
export const PRODUCTION_TYPES = ['wild', 'farmed', 'both'] as const;

export type PartnerKind = (typeof PARTNER_KINDS)[number];
export type PartnerRole = (typeof PARTNER_ROLES)[number];

const Roles = z
  .array(z.enum(PARTNER_ROLES))
  .min(1, 'Choose at least one role')
  .max(3)
  .refine((roles) => new Set(roles).size === roles.length, 'Each role can be listed once');

const Text = (max: number) => z.string().trim().min(1).max(max);

/**
 * A supplier, buyer and/or transporter in one organisation's books. Deliberately minimal
 * personal data (name, phone): partners are people who did not sign up to the platform.
 */
export const TradingPartnerSchema = z.object({
  id: Uuid,
  kind: z.enum(PARTNER_KINDS),
  name: z.string(),
  phone: z.string().nullable(),
  roles: z.array(z.enum(PARTNER_ROLES)),
  productionType: z.enum(PRODUCTION_TYPES).nullable(),
  landingSite: z.string().nullable(),
  notes: z.string().nullable(),
  speciesIds: z.array(Uuid),
  archived: z.boolean(),
  version: z.number().int(),
});
export type TradingPartner = z.infer<typeof TradingPartnerSchema>;

export const CreateTradingPartnerSchema = z.strictObject({
  kind: z.enum(PARTNER_KINDS),
  name: Text(160),
  phone: PhoneE164.optional(),
  roles: Roles,
  productionType: z.enum(PRODUCTION_TYPES).optional(),
  /** Home landing site or location (free text until the geographic registry). */
  landingSite: Text(160).optional(),
  notes: Text(1000).optional(),
  speciesIds: z.array(Uuid).max(20).default([]),
});
export type CreateTradingPartner = z.input<typeof CreateTradingPartnerSchema>;

export const UpdateTradingPartnerSchema = z.strictObject({
  /** Optimistic concurrency: the version you last read. */
  version: z.number().int().positive(),
  kind: z.enum(PARTNER_KINDS).optional(),
  name: Text(160).optional(),
  phone: PhoneE164.nullable().optional(),
  roles: Roles.optional(),
  productionType: z.enum(PRODUCTION_TYPES).nullable().optional(),
  landingSite: Text(160).nullable().optional(),
  notes: Text(1000).nullable().optional(),
  /** Replaces the partner's species when present. */
  speciesIds: z.array(Uuid).max(20).optional(),
  archived: z.boolean().optional(),
});
export type UpdateTradingPartner = z.input<typeof UpdateTradingPartnerSchema>;

export const ListTradingPartnersQuerySchema = z.object({
  role: z.enum(PARTNER_ROLES).optional(),
  /** Matches part of the name, or digits of the phone number. */
  q: z.string().trim().min(1).max(80).optional(),
  speciesId: Uuid.optional(),
  includeArchived: z.stringbool().optional(),
});
