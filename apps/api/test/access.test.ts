// Organisations and authorisation through the real HTTP API: registration, idempotency,
// cross-tenant isolation, invitations, permissions — and the "every route declares a policy" rule.
import { auditLog, createDatabase, organisations, type DatabaseHandle } from '@blue/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ACCESS_POLICY } from '../src/platform/access/access-policy.js';
import { SMS_SENDER, type SmsSender } from '../src/platform/identity/sms-sender.js';
import { Client, signIn } from './helpers/http-client.js';
import {
  startApp,
  startTestEnvironment,
  type TestEnvironment,
} from './helpers/test-environment.js';

let env: TestEnvironment;
let app: NestFastifyApplication;
let sms: MockInstance<SmsSender['send']>;
/** Superuser connection: bypasses RLS, for assertions across tenants only. */
let admin: DatabaseHandle;
let counter = 0;
const nextPhone = () => `+2567${String(10_000_000 + ++counter).slice(-8)}`;
const nextSlug = () => `org-${Date.now().toString(36)}-${++counter}`;

interface Org {
  id: string;
  slug: string;
}

async function registerOrg(owner: Client, overrides: Record<string, unknown> = {}): Promise<Org> {
  const response = await owner.request('POST', '/v1/orgs', {
    body: {
      legalName: 'Lake Traders Ltd',
      slug: nextSlug(),
      countryCode: 'KE',
      organisationTypes: ['trader_aggregator'],
      ...overrides,
    },
  });
  if (response.statusCode !== 201) throw new Error(`register failed: ${response.body}`);
  return response.json<Org>();
}

async function newUser(): Promise<{ client: Client; phone: string; userId: string }> {
  const client = new Client(app);
  const phone = nextPhone();
  const userId = await signIn(client, sms, phone);
  return { client, phone, userId };
}

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  sms = vi.spyOn(app.get<SmsSender>(SMS_SENDER), 'send');
  admin = createDatabase(env.database.container.getConnectionUri(), { maxConnections: 1 });
});

afterAll(async () => {
  await admin?.close();
  await app?.close();
  await env?.stop();
});

describe('organisation registration', () => {
  it('makes the caller Owner with every platform permission and pilot product access', async () => {
    const { client } = await newUser();
    const org = await registerOrg(client);
    const me = await client.request('GET', '/v1/me');
    const [membership] = me.json<{ organisations: Record<string, unknown>[] }>().organisations;
    expect(membership).toMatchObject({
      organisation: { id: org.id, countryCode: 'KE', defaultCurrency: 'KES' },
      membershipStatus: 'active',
      roles: ['owner'],
      products: ['bluedata', 'samakios'],
    });
    expect(membership?.permissions).toContain('platform.data_sharing.manage');
  });

  it('records an audit entry attributed to the registering user', async () => {
    const { client, userId } = await newUser();
    const org = await registerOrg(client);
    const entries = await env.database.runtime.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${org.id}, true)`);
      return tx.select().from(auditLog).where(eq(auditLog.entityId, org.id));
    });
    expect(entries).toEqual([
      expect.objectContaining({
        action: 'organisation.registered',
        actorUserId: userId,
        organisationId: org.id,
      }),
    ]);
  });

  it('rejects a taken slug and countries that are not open yet', async () => {
    const { client } = await newUser();
    const org = await registerOrg(client);
    const taken = await client.request('POST', '/v1/orgs', {
      body: {
        legalName: 'Copycat',
        slug: org.slug,
        countryCode: 'KE',
        organisationTypes: ['processor'],
      },
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'SLUG_TAKEN' });

    const rwanda = await client.request('POST', '/v1/orgs', {
      body: {
        legalName: 'Kigali Fish',
        slug: nextSlug(),
        countryCode: 'RW',
        organisationTypes: ['processor'],
      },
    });
    expect(rwanda.statusCode).toBe(422);
    expect(rwanda.json()).toMatchObject({ code: 'COUNTRY_NOT_SUPPORTED' });
  });
});

describe('idempotency keys', () => {
  it('are required on signed-in POSTs', async () => {
    const { client } = await newUser();
    const response = await client.request('POST', '/v1/orgs', {
      body: {
        legalName: 'X',
        slug: nextSlug(),
        countryCode: 'KE',
        organisationTypes: ['processor'],
      },
      idempotencyKey: null,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('replay the original response for a retried request instead of acting twice', async () => {
    const { client } = await newUser();
    const body = {
      legalName: 'Retry Fisheries',
      slug: nextSlug(),
      countryCode: 'UG',
      organisationTypes: ['processor'],
    };
    const first = await client.request('POST', '/v1/orgs', {
      body,
      idempotencyKey: 'offline-retry-0001',
    });
    const retry = await client.request('POST', '/v1/orgs', {
      body,
      idempotencyKey: 'offline-retry-0001',
    });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());

    const created = await admin.db
      .select()
      .from(organisations)
      .where(eq(organisations.slug, body.slug));
    expect(created).toHaveLength(1);
  });

  it('reject reusing a key for a different request', async () => {
    const { client } = await newUser();
    const base = { legalName: 'Alpha Fish', countryCode: 'KE', organisationTypes: ['processor'] };
    await client.request('POST', '/v1/orgs', {
      body: { ...base, slug: nextSlug() },
      idempotencyKey: 'reused-key-0001',
    });
    const reused = await client.request('POST', '/v1/orgs', {
      body: { ...base, slug: nextSlug() },
      idempotencyKey: 'reused-key-0001',
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('are scoped to the user: the same key from someone else is a new request', async () => {
    const a = await newUser();
    const b = await newUser();
    const body = (slug: string) => ({
      legalName: 'Same Key',
      slug,
      countryCode: 'KE',
      organisationTypes: ['processor'],
    });
    const fromA = await a.client.request('POST', '/v1/orgs', {
      body: body(nextSlug()),
      idempotencyKey: 'shared-key-0001',
    });
    const fromB = await b.client.request('POST', '/v1/orgs', {
      body: body(nextSlug()),
      idempotencyKey: 'shared-key-0001',
    });
    expect(fromA.statusCode).toBe(201);
    expect(fromB.statusCode).toBe(201);
    expect(fromB.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('tenant isolation over HTTP', () => {
  it('another organisation is indistinguishable from one that does not exist', async () => {
    const alice = await newUser();
    const bob = await newUser();
    const orgA = await registerOrg(alice.client);
    await registerOrg(bob.client);

    for (const [method, url, body] of [
      ['GET', `/v1/orgs/${orgA.id}`, undefined],
      ['GET', `/v1/orgs/${orgA.id}/members`, undefined],
      [
        'POST',
        `/v1/orgs/${orgA.id}/members/invitations`,
        { phone: nextPhone(), displayName: 'Mallory', roleKeys: ['admin'] },
      ],
      ['GET', '/v1/orgs/01900000-0000-7000-8000-000000000000', undefined],
      ['GET', '/v1/orgs/not-a-uuid', undefined],
    ] as const) {
      const response = await bob.client.request(method, url, body === undefined ? {} : { body });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json()).toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});

describe('invitations and permissions', () => {
  it('an invited viewer gains access only after accepting, and only read access', async () => {
    const owner = await newUser();
    const org = await registerOrg(owner.client);
    const inviteePhone = nextPhone();

    const invite = await owner.client.request('POST', `/v1/orgs/${org.id}/members/invitations`, {
      body: { phone: inviteePhone, displayName: 'Baraka', roleKeys: ['viewer'] },
    });
    expect(invite.statusCode).toBe(201);

    const invitee = new Client(app);
    await signIn(invitee, sms, inviteePhone);
    const pending = await invitee.request('GET', '/v1/me');
    expect(pending.json<{ organisations: unknown[] }>().organisations).toEqual([
      expect.objectContaining({
        membershipStatus: 'invited',
        permissions: [],
        organisation: expect.objectContaining({ id: org.id }),
      }),
    ]);
    expect((await invitee.request('GET', `/v1/orgs/${org.id}`)).statusCode).toBe(404); // not active yet

    const accepted = await invitee.request('POST', `/v1/me/invitations/${org.id}/accept`);
    expect(accepted.statusCode).toBe(200);
    expect((await invitee.request('GET', `/v1/orgs/${org.id}`)).statusCode).toBe(200);

    const members = await invitee.request('GET', `/v1/orgs/${org.id}/members`);
    expect(members.statusCode).toBe(200);
    expect(members.json<{ displayName: string; phone: string }[]>()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'Baraka', roles: ['viewer'] }),
      ]),
    );
    // Other members' phone numbers are masked.
    expect(members.body).not.toContain(owner.phone);

    const escalate = await invitee.request('POST', `/v1/orgs/${org.id}/members/invitations`, {
      body: { phone: nextPhone(), displayName: 'Friend', roleKeys: ['admin'] },
    });
    expect(escalate.statusCode).toBe(403);
    expect(escalate.json()).toMatchObject({
      code: 'FORBIDDEN',
      detail: 'Requires the platform.members.invite permission.',
    });
  });

  it('refuses to invite someone twice', async () => {
    const owner = await newUser();
    const org = await registerOrg(owner.client);
    const body = { phone: nextPhone(), displayName: 'Twice', roleKeys: ['viewer'] };
    expect(
      (await owner.client.request('POST', `/v1/orgs/${org.id}/members/invitations`, { body }))
        .statusCode,
    ).toBe(201);
    const again = await owner.client.request('POST', `/v1/orgs/${org.id}/members/invitations`, {
      body,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'ALREADY_MEMBER' });
  });

  it('cannot accept an invitation that does not exist', async () => {
    const stranger = await newUser();
    const owner = await newUser();
    const org = await registerOrg(owner.client);
    const response = await stranger.client.request('POST', `/v1/me/invitations/${org.id}/accept`);
    expect(response.statusCode).toBe(404);
  });
});

describe('route policies', () => {
  it('every route in the application declares an access policy', () => {
    const reflector = app.get(Reflector);
    const undeclared: string[] = [];
    let routes = 0;
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
        if (!controller) continue;
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = (controller.prototype as Record<string, unknown>)[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (Reflect.getMetadata('method', handler) === undefined) continue; // not a route
          routes++;
          if (!reflector.getAllAndOverride(ACCESS_POLICY, [handler, controller])) {
            undeclared.push(`${controller.name}.${name}`);
          }
        }
      }
    }
    expect(routes).toBeGreaterThan(10);
    expect(undeclared).toEqual([]);
  });
});
