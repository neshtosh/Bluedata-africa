import { z } from 'zod';
import {
  OtpRequestResponseSchema,
  OtpRequestSchema,
  OtpVerifySchema,
  PasswordLoginSchema,
  SetPasswordSchema,
} from './auth.js';
import {
  CatalogueItemSchema,
  CreateCatalogueItemSchema,
  UpdateCatalogueItemSchema,
  VocabularySchema,
} from './catalogue.js';
import { Uuid } from './common.js';
import { defineEndpoint } from './endpoint.js';
import {
  CreateOrganisationSchema,
  InviteMemberSchema,
  OrganisationSummarySchema,
} from './organisations.js';
import {
  CreateTradingPartnerSchema,
  ListTradingPartnersQuerySchema,
  TradingPartnerSchema,
  UpdateTradingPartnerSchema,
} from './partners.js';
import {
  HealthLiveSchema,
  HealthReadySchema,
  InvitationAcceptedSchema,
  InvitationCreatedSchema,
  MemberSchema,
  MeSchema,
  SessionStartedSchema,
} from './responses.js';

const OrgParams = z.object({ orgId: Uuid });

/**
 * The API's endpoint registry. Every route the API serves must appear here exactly once
 * (enforced by apps/api/test/contract.test.ts).
 */
export const endpoints = {
  health: {
    live: defineEndpoint({
      method: 'GET',
      path: '/health/live',
      versioned: false,
      summary: 'Liveness probe',
      tags: ['system'],
      auth: 'public',
      idempotencyKey: 'none',
      response: HealthLiveSchema,
      status: 200,
    }),
    ready: defineEndpoint({
      method: 'GET',
      path: '/health/ready',
      versioned: false,
      summary: 'Readiness probe (database and Valkey reachable)',
      tags: ['system'],
      auth: 'public',
      idempotencyKey: 'none',
      response: HealthReadySchema,
      status: 200,
    }),
  },

  auth: {
    requestOtp: defineEndpoint({
      method: 'POST',
      path: '/auth/otp/request',
      summary: 'Send a one-time sign-in code by SMS',
      description:
        'Same response whether or not an account exists. Rate-limited per number and per IP.',
      tags: ['auth'],
      auth: 'public',
      idempotencyKey: 'none',
      body: OtpRequestSchema,
      response: OtpRequestResponseSchema,
      status: 202,
    }),
    verifyOtp: defineEndpoint({
      method: 'POST',
      path: '/auth/otp/verify',
      summary: 'Exchange a one-time code for a session',
      description:
        'Creates the account on first sign-in (displayName required, otherwise 422 DISPLAY_NAME_REQUIRED). Sets the session cookie.',
      tags: ['auth'],
      auth: 'public',
      idempotencyKey: 'none',
      body: OtpVerifySchema,
      response: SessionStartedSchema,
      status: 200,
    }),
    passwordLogin: defineEndpoint({
      method: 'POST',
      path: '/auth/password/login',
      summary: 'Sign in with phone number and password',
      tags: ['auth'],
      auth: 'public',
      idempotencyKey: 'none',
      body: PasswordLoginSchema,
      response: SessionStartedSchema,
      status: 200,
    }),
    logout: defineEndpoint({
      method: 'POST',
      path: '/auth/logout',
      summary: 'Revoke the current session',
      tags: ['auth'],
      auth: 'session',
      idempotencyKey: 'none',
      status: 204,
    }),
  },

  me: {
    get: defineEndpoint({
      method: 'GET',
      path: '/me',
      summary: 'The signed-in user, their organisations and invitations',
      tags: ['me'],
      auth: 'session',
      idempotencyKey: 'none',
      response: MeSchema,
      status: 200,
    }),
    setPassword: defineEndpoint({
      method: 'PUT',
      path: '/me/password',
      summary: 'Set or change password (signs out other sessions)',
      tags: ['me'],
      auth: 'session',
      idempotencyKey: 'none',
      body: SetPasswordSchema,
      status: 204,
    }),
    acceptInvitation: defineEndpoint({
      method: 'POST',
      path: '/me/invitations/:orgId/accept',
      summary: 'Accept a pending invitation',
      tags: ['me'],
      auth: 'session',
      idempotencyKey: 'required',
      params: OrgParams,
      response: InvitationAcceptedSchema,
      status: 200,
    }),
  },

  orgs: {
    register: defineEndpoint({
      method: 'POST',
      path: '/orgs',
      summary: 'Register an organisation (caller becomes Owner)',
      tags: ['organisations'],
      auth: 'session',
      idempotencyKey: 'required',
      body: CreateOrganisationSchema,
      response: OrganisationSummarySchema,
      status: 201,
    }),
    get: defineEndpoint({
      method: 'GET',
      path: '/orgs/:orgId',
      summary: 'Organisation profile',
      tags: ['organisations'],
      auth: 'session',
      idempotencyKey: 'none',
      params: OrgParams,
      response: OrganisationSummarySchema,
      status: 200,
    }),
    listMembers: defineEndpoint({
      method: 'GET',
      path: '/orgs/:orgId/members',
      summary: 'Members, invitations and their roles',
      tags: ['organisations'],
      auth: 'session',
      idempotencyKey: 'none',
      params: OrgParams,
      response: z.array(MemberSchema),
      status: 200,
    }),
    invite: defineEndpoint({
      method: 'POST',
      path: '/orgs/:orgId/members/invitations',
      summary: 'Invite a person by phone number',
      tags: ['organisations'],
      auth: 'session',
      idempotencyKey: 'required',
      params: OrgParams,
      body: InviteMemberSchema,
      response: InvitationCreatedSchema,
      status: 201,
    }),
  },

  ref: {
    vocabulary: defineEndpoint({
      method: 'GET',
      path: '/ref/vocabulary',
      summary: 'Species (with local names), product forms and units',
      tags: ['reference'],
      auth: 'session',
      idempotencyKey: 'none',
      response: VocabularySchema,
      status: 200,
    }),
  },

  catalogue: {
    list: defineEndpoint({
      method: 'GET',
      path: '/orgs/:orgId/catalogue-items',
      summary: 'Items the organisation buys and sells',
      tags: ['samakios'],
      auth: 'session',
      idempotencyKey: 'none',
      params: OrgParams,
      query: z.object({ includeArchived: z.stringbool().optional() }),
      response: z.array(CatalogueItemSchema),
      status: 200,
    }),
    create: defineEndpoint({
      method: 'POST',
      path: '/orgs/:orgId/catalogue-items',
      summary: 'Add a catalogue item (species × form × grade × size) with its unit weights',
      tags: ['samakios'],
      auth: 'session',
      idempotencyKey: 'required',
      params: OrgParams,
      body: CreateCatalogueItemSchema,
      response: CatalogueItemSchema,
      status: 201,
    }),
    update: defineEndpoint({
      method: 'PATCH',
      path: '/orgs/:orgId/catalogue-items/:itemId',
      summary: 'Edit or archive a catalogue item (send the version you last read)',
      tags: ['samakios'],
      auth: 'session',
      idempotencyKey: 'none',
      params: z.object({ orgId: Uuid, itemId: Uuid }),
      body: UpdateCatalogueItemSchema,
      response: CatalogueItemSchema,
      status: 200,
    }),
  },

  partners: {
    list: defineEndpoint({
      method: 'GET',
      path: '/orgs/:orgId/partners',
      summary: 'Suppliers, buyers and transporters (filter by role, species or search text)',
      tags: ['samakios'],
      auth: 'session',
      idempotencyKey: 'none',
      params: OrgParams,
      query: ListTradingPartnersQuerySchema,
      response: z.array(TradingPartnerSchema),
      status: 200,
    }),
    create: defineEndpoint({
      method: 'POST',
      path: '/orgs/:orgId/partners',
      summary: 'Add a trading partner',
      tags: ['samakios'],
      auth: 'session',
      idempotencyKey: 'required',
      params: OrgParams,
      body: CreateTradingPartnerSchema,
      response: TradingPartnerSchema,
      status: 201,
    }),
    update: defineEndpoint({
      method: 'PATCH',
      path: '/orgs/:orgId/partners/:partnerId',
      summary: 'Edit or archive a trading partner (send the version you last read)',
      tags: ['samakios'],
      auth: 'session',
      idempotencyKey: 'none',
      params: z.object({ orgId: Uuid, partnerId: Uuid }),
      body: UpdateTradingPartnerSchema,
      response: TradingPartnerSchema,
      status: 200,
    }),
  },

  system: {
    openapi: defineEndpoint({
      method: 'GET',
      path: '/openapi.json',
      summary: 'This OpenAPI document (non-production environments only)',
      tags: ['system'],
      auth: 'public',
      idempotencyKey: 'none',
      response: z.record(z.string(), z.unknown()),
      status: 200,
    }),
  },
} as const;

/** Every endpoint as a flat list, with a stable `<group>.<name>` id. */
export function listEndpoints() {
  return Object.entries(endpoints).flatMap(([group, members]) =>
    Object.entries(members).map(([name, endpoint]) => ({ id: `${group}.${name}`, endpoint })),
  );
}
