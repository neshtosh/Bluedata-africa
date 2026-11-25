// SamakiOS catalogue over HTTP: vocabulary, unit-weight rules, concurrency, archiving,
// permissions, tenant isolation and product entitlement.
import { createDatabase, subscriptions, type DatabaseHandle } from '@blue/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
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
let admin: DatabaseHandle;
let counter = 0;
const nextPhone = () => `+2557${String(10_000_000 + ++counter).slice(-8)}`;

interface Species {
  id: string;
  scientificName: string;
  names: { name: string }[];
}
let omena: Species;

async function ownerWithOrg() {
  const client = new Client(app);
  await signIn(client, sms, nextPhone());
  const org = await client.request('POST', '/v1/orgs', {
    body: {
      legalName: `Catalogue Co ${++counter}`,
      slug: `catalogue-co-${Date.now().toString(36)}-${counter}`,
      countryCode: 'KE',
      organisationTypes: ['trader_aggregator'],
    },
  });
  return { client, orgId: org.json<{ id: string }>().id };
}

const omenaBasin = () => ({
  speciesId: omena.id,
  productFormCode: 'sun_dried',
  defaultUnitCode: 'basin',
  units: [{ unitCode: 'basin', kgPerUnit: '18.5' }],
});

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  sms = vi.spyOn(app.get<SmsSender>(SMS_SENDER), 'send');
  admin = createDatabase(env.database.container.getConnectionUri(), { maxConnections: 1 });
  const { client } = await ownerWithOrg();
  const vocabulary = await client.request('GET', '/v1/ref/vocabulary');
  const found = vocabulary
    .json<{ species: Species[] }>()
    .species.find((s) => s.scientificName === 'Rastrineobola argentea');
  if (!found) throw new Error('omena not seeded');
  omena = found;
});

afterAll(async () => {
  await admin?.close();
  await app?.close();
  await env?.stop();
});

describe('reference vocabulary', () => {
  it('lists species with their local names, product forms and units', async () => {
    const { client } = await ownerWithOrg();
    const vocabulary = await client.request('GET', '/v1/ref/vocabulary');
    expect(vocabulary.statusCode).toBe(200);
    const body = vocabulary.json<{
      species: Species[];
      productForms: { code: string }[];
      units: { code: string; dimension: string; kgFactor: string | null }[];
    }>();
    expect(body.species.map((s) => s.scientificName)).toEqual(
      expect.arrayContaining([
        'Lates niloticus',
        'Oreochromis niloticus',
        'Rastrineobola argentea',
      ]),
    );
    expect(omena.names.map((n) => n.name)).toEqual(
      expect.arrayContaining(['omena', 'mukene', 'dagaa']),
    );
    expect(body.productForms.map((f) => f.code)).toEqual(
      expect.arrayContaining(['fresh_whole', 'sun_dried', 'fish_maw']),
    );
    expect(body.units).toEqual(
      expect.arrayContaining([
        { code: 'kg', name: 'Kilogram', dimension: 'mass', kgFactor: '1' },
        { code: 'g', name: 'Gram', dimension: 'mass', kgFactor: '0.001' },
        { code: 'basin', name: 'Basin', dimension: 'container', kgFactor: null }, // no invented weight
      ]),
    );
  });

  it('requires a session', async () => {
    expect(
      (await new Client(app).request('GET', '/v1/ref/vocabulary', { cookie: null })).statusCode,
    ).toBe(401);
  });
});

describe('catalogue items', () => {
  it("records an item with the organisation's own basin weight and names it", async () => {
    const { client, orgId } = await ownerWithOrg();
    const created = await client.request('POST', `/v1/orgs/${orgId}/catalogue-items`, {
      body: omenaBasin(),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Silver cyprinid — Sun-dried',
      defaultUnitCode: 'basin',
      units: [{ unitCode: 'basin', kgPerUnit: '18.5' }],
      archived: false,
      version: 1,
    });

    const list = await client.request('GET', `/v1/orgs/${orgId}/catalogue-items`);
    expect(list.json<unknown[]>()).toHaveLength(1);
  });

  it('refuses a container default unit without a recorded weight', async () => {
    const { client, orgId } = await ownerWithOrg();
    const response = await client.request('POST', `/v1/orgs/${orgId}/catalogue-items`, {
      body: { ...omenaBasin(), units: [] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { path: string; code: string }[] }>().errors).toEqual([
      expect.objectContaining({ path: 'defaultUnitCode', code: 'no_weight' }),
    ]);
  });

  it('refuses custom weights for mass units, unknown units and duplicates', async () => {
    const { client, orgId } = await ownerWithOrg();
    const response = await client.request('POST', `/v1/orgs/${orgId}/catalogue-items`, {
      body: {
        ...omenaBasin(),
        units: [
          { unitCode: 'kg', kgPerUnit: '2' },
          { unitCode: 'barrel', kgPerUnit: '100' },
          { unitCode: 'basin', kgPerUnit: '18.5' },
          { unitCode: 'basin', kgPerUnit: '19' },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    const codes = response.json<{ errors: { code: string }[] }>().errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(['fixed_weight', 'unknown', 'duplicate']));
  });

  it('rejects malformed or non-positive weights at the contract', async () => {
    const { client, orgId } = await ownerWithOrg();
    for (const kgPerUnit of ['0', '-1', '18,5', '1.1234567']) {
      const response = await client.request('POST', `/v1/orgs/${orgId}/catalogue-items`, {
        body: { ...omenaBasin(), units: [{ unitCode: 'basin', kgPerUnit }] },
      });
      expect(response.statusCode, kgPerUnit).toBe(400);
    }
  });

  it('refuses the same item twice', async () => {
    const { client, orgId } = await ownerWithOrg();
    await client.request('POST', `/v1/orgs/${orgId}/catalogue-items`, { body: omenaBasin() });
    const again = await client.request('POST', `/v1/orgs/${orgId}/catalogue-items`, {
      body: omenaBasin(),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'CATALOGUE_ITEM_EXISTS' });
  });

  it('detects concurrent edits and archives items out of the default list', async () => {
    const { client, orgId } = await ownerWithOrg();
    const item = (
      await client.request('POST', `/v1/orgs/${orgId}/catalogue-items`, { body: omenaBasin() })
    ).json<{
      id: string;
    }>();
    const url = `/v1/orgs/${orgId}/catalogue-items/${item.id}`;

    const edited = await client.request('PATCH', url, {
      body: {
        version: 1,
        units: [
          { unitCode: 'basin', kgPerUnit: '19.25' },
          { unitCode: 'tin', kgPerUnit: '2' },
        ],
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      version: 2,
      units: expect.arrayContaining([{ unitCode: 'tin', kgPerUnit: '2' }]),
    });

    const stale = await client.request('PATCH', url, { body: { version: 1, name: 'Late edit' } });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ code: 'STALE_VERSION' });

    const archived = await client.request('PATCH', url, { body: { version: 2, archived: true } });
    expect(archived.json()).toMatchObject({ archived: true, version: 3 });
    expect(
      (await client.request('GET', `/v1/orgs/${orgId}/catalogue-items`)).json<unknown[]>(),
    ).toHaveLength(0);
    expect(
      (await client.request('GET', `/v1/orgs/${orgId}/catalogue-items?includeArchived=true`)).json<
        unknown[]
      >(),
    ).toHaveLength(1);
  });
});

describe('access', () => {
  it('viewers can read the catalogue but not change it', async () => {
    const { client: owner, orgId } = await ownerWithOrg();
    const viewerPhone = nextPhone();
    await owner.request('POST', `/v1/orgs/${orgId}/members/invitations`, {
      body: { phone: viewerPhone, displayName: 'Viewer', roleKeys: ['viewer'] },
    });
    const viewer = new Client(app);
    await signIn(viewer, sms, viewerPhone);
    await viewer.request('POST', `/v1/me/invitations/${orgId}/accept`);

    expect((await viewer.request('GET', `/v1/orgs/${orgId}/catalogue-items`)).statusCode).toBe(200);
    const create = await viewer.request('POST', `/v1/orgs/${orgId}/catalogue-items`, {
      body: omenaBasin(),
    });
    expect(create.statusCode).toBe(403);
    expect(create.json()).toMatchObject({
      detail: 'Requires the samakios.catalogue.manage permission.',
    });
  });

  it("another organisation's catalogue is invisible", async () => {
    const a = await ownerWithOrg();
    const b = await ownerWithOrg();
    const item = (
      await a.client.request('POST', `/v1/orgs/${a.orgId}/catalogue-items`, { body: omenaBasin() })
    ).json<{
      id: string;
    }>();
    expect((await b.client.request('GET', `/v1/orgs/${a.orgId}/catalogue-items`)).statusCode).toBe(
      404,
    );
    const patch = await b.client.request(
      'PATCH',
      `/v1/orgs/${b.orgId}/catalogue-items/${item.id}`,
      {
        body: { version: 1, name: 'Hijacked' },
      },
    );
    expect(patch.statusCode).toBe(404); // B's own org route, A's item id: not found under RLS
  });

  it('requires a SamakiOS subscription', async () => {
    const { client, orgId } = await ownerWithOrg();
    await admin.db
      .update(subscriptions)
      .set({ status: 'cancelled' })
      .where(
        and(eq(subscriptions.organisationId, orgId), eq(subscriptions.productCode, 'samakios')),
      );
    const response = await client.request('GET', `/v1/orgs/${orgId}/catalogue-items`);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'PRODUCT_NOT_ENTITLED' });
  });
});
