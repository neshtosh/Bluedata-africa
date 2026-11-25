import { z } from 'zod';
import { Uuid } from './common.js';
import { OrganisationSummarySchema } from './organisations.js';

export const HealthLiveSchema = z.object({ status: z.literal('ok') });

export const HealthReadySchema = z.object({
  status: z.literal('ok'),
  checks: z.object({ database: z.literal('ok'), valkey: z.literal('ok') }),
});

/** Returned by OTP verify and password login. The session token is only in the cookie. */
export const SessionStartedSchema = z.object({
  user: z.object({ id: Uuid, displayName: z.string() }),
  sessionExpiresAt: z.iso.datetime(),
});
export type SessionStarted = z.infer<typeof SessionStartedSchema>;

export const MembershipStatusSchema = z.enum(['invited', 'active', 'suspended', 'removed']);

export const MyOrganisationSchema = z.object({
  organisation: OrganisationSummarySchema,
  membershipStatus: z.enum(['active', 'invited']),
  /** Empty until an invitation is accepted. */
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  products: z.array(z.enum(['samakios', 'bluedata'])),
});

export const MeSchema = z.object({
  user: z.object({
    id: Uuid,
    displayName: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    locale: z.string(),
    mfaEnabled: z.boolean(),
    hasPassword: z.boolean(),
  }),
  organisations: z.array(MyOrganisationSchema),
});
export type Me = z.infer<typeof MeSchema>;

export const MemberSchema = z.object({
  membershipId: Uuid,
  userId: Uuid,
  status: MembershipStatusSchema,
  displayName: z.string(),
  /** Masked, e.g. +254*******01. */
  phone: z.string().nullable(),
  roles: z.array(z.string()),
});
export type Member = z.infer<typeof MemberSchema>;

export const InvitationCreatedSchema = z.object({
  membershipId: Uuid,
  status: z.literal('invited'),
});

export const InvitationAcceptedSchema = z.object({
  membershipId: Uuid,
  status: z.literal('active'),
});

/** RFC 9457 problem details — the body of every error response (API.md §1.1). */
export const ProblemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string(),
  requestId: z.string(),
  errors: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
});
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;
