import { z } from 'zod';
import { CountryCode, DisplayName, PhoneE164, Slug, Uuid } from './common.js';
import { SYSTEM_ROLES, type SystemRoleKey } from './permissions.js';

/**
 * Organisation types (seeded into ref.organisation_types). Source of truth for the seed and for
 * the registration form; labels here are English defaults — UIs translate by code.
 */
export const ORGANISATION_TYPES = [
  { code: 'fisher', name: 'Fisher' },
  { code: 'cooperative', name: 'Fishing cooperative' },
  { code: 'bmu', name: 'Beach Management Unit' },
  { code: 'trader_aggregator', name: 'Trader / aggregator' },
  { code: 'wholesaler', name: 'Wholesaler' },
  { code: 'processor', name: 'Processor' },
  { code: 'exporter', name: 'Exporter' },
  { code: 'fish_farm', name: 'Fish farm' },
  { code: 'distributor', name: 'Distributor' },
  { code: 'cold_storage_operator', name: 'Cold-storage operator' },
  { code: 'association', name: 'Fisheries association' },
  { code: 'government_agency', name: 'Government agency' },
  { code: 'research_institution', name: 'Research institution' },
  { code: 'ngo', name: 'Development organisation / NGO' },
  { code: 'investor', name: 'Investor' },
] as const;
export type OrganisationTypeCode = (typeof ORGANISATION_TYPES)[number]['code'];

const SystemRoleKeySchema = z.enum(
  Object.keys(SYSTEM_ROLES) as [SystemRoleKey, ...SystemRoleKey[]],
);

/** POST /v1/orgs — register an organisation; the caller becomes its Owner. */
export const CreateOrganisationSchema = z.strictObject({
  legalName: z.string().trim().min(2).max(200),
  tradingName: z.string().trim().min(1).max(200).optional(),
  slug: Slug,
  countryCode: CountryCode,
  /** Codes from ref.organisation_types, e.g. trader_aggregator, processor. */
  organisationTypes: z
    .array(z.string().regex(/^[a-z_]+$/))
    .min(1)
    .max(5),
});
export type CreateOrganisation = z.infer<typeof CreateOrganisationSchema>;

/** POST /v1/orgs/{orgId}/members/invitations */
export const InviteMemberSchema = z.strictObject({
  phone: PhoneE164,
  displayName: DisplayName,
  roleKeys: z.array(SystemRoleKeySchema).min(1),
});
export type InviteMember = z.infer<typeof InviteMemberSchema>;

export const OrganisationSummarySchema = z.object({
  id: Uuid,
  legalName: z.string(),
  tradingName: z.string().nullable(),
  slug: z.string(),
  countryCode: z.string(),
  defaultCurrency: z.string(),
});
export type OrganisationSummary = z.infer<typeof OrganisationSummarySchema>;
