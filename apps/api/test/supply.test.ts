// SamakiOS supply records over HTTP: kg conversion through the organisation's unit weights,
// supplier and item rules, prices in the organisation's currency, status changes, expiry,
// permissions and tenant isolation.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SMS_SENDER, type SmsSender } from '../src/platform/identity/sms-sender.js';
import { todayIn } from '../src/samakios/shared/trading-rules.js';
import { Client, signIn } from './helpers/http-client.js';
import {
  startApp,
  startTestEnvironment,
  type TestEnvironment,
} from './helpers/test-environment.js';

let env: TestEnvironment;
let app: NestFastifyApplication;
let sms: MockInstance<SmsSender['send']>;
let counter = 0;
const nextPhone = () => `+2557${String(20_000_000 + ++counter).slice(-8)}`;

interface Supply {
  id: string;
  origin: string;
  quantity: string;
  unitCode: string;
  quantityKg: string;
  availableUntil: string | null;
  askingPrice: string | null;
  currency: string | null;
  location: string | null;
  status: string;
  expired: boolean;
  version: number;
}
let omenaId: string;
let perchId: string;

/** An organisation with an omena item (basin = 18.5 kg) and one wild supplier. */
async function trader(countryCode = 'KE') {
  const client = new Client(app);
  await signIn(client, sms, nextPhone());
  const org = await client.request('POST', '/v1/orgs', {
    body: {
      legalName: `Supply Co ${++counter}`,
      slug: `supply-co-${Date.now().toString(36)}-${counter}`,
      countryCode,
      organisationTypes: ['trader_aggregator'],
    },
  });
  const orgId = org.json<{ id: string }>().id;
  const base = `/v1/orgs/${orgId}`;
  const item = await client.request('POST', `${base}/catalogue-items`, {
    body: {
      speciesId: omenaId,
      productFormCode: 'sun_dried',
      defaultUnitCode: 'basin',
      units: [{ unitCode: 'basin', kgPerUnit: '18.5' }],
    },
  });
  const partner = await client.request('POST', `${base}/partners`, {
    body: {
      kind: 'individual',
      name: 'Otieno',
      roles: ['supplier'],
      productionType: 'wild',
      landingSite: 'Dunga',
    },
  });
  const url = `${base}/supply-records`;
  const ids = {
    itemId: item.json<{ id: string }>().id,
    partnerId: partner.json<{ id: string }>().id,
  };
  const offer = (body: Record<string, unknown> = {}) =>
    client.request('POST', url, {
      body: {
        partnerId: ids.partnerId,
        catalogueItemId: ids.itemId,
        quantity: '2',
        availableFrom: '2026-11-20',
        ...body,
      },
    });
  return { client, base, url, offer, ...ids };
}

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  sms = vi.spyOn(app.get<SmsSender>(SMS_SENDER), 'send');
  const client = new Client(app);
  await signIn(client, sms, nextPhone());
  const species = (await client.request('GET', '/v1/ref/vocabulary')).json<{
    species: { id: string; scientificName: string }[];
  }>().species;
  const idOf = (name: string) => {
    const found = species.find((s) => s.scientificName === name);
    if (!found) throw new Error(`${name} not seeded`);
    return found.id;
  };
  omenaId = idOf('Rastrineobola argentea');
  perchId = idOf('Lates niloticus');
});

afterAll(async () => {
  await app?.close();
  await env?.stop();
});

describe('recording supply', () => {
  it("converts to kg with the organisation's basin weight and fills defaults", async () => {
    const { offer } = await trader();
    const created = await offer({ quantity: '2.5', askingPrice: '1500.50' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      origin: 'wild', // from the supplier
      quantity: '2.5',
      unitCode: 'basin', // the item's default unit
      quantityKg: '46.25',
      askingPrice: '1500.50',
      currency: 'KES',
      location: 'Dunga', // the supplier's landing site
      status: 'available',
      expired: false,
      version: 1,
    });
  });

  it('uses fixed factors for mass units', async () => {
    const { offer } = await trader();
    const created = await offer({ quantity: '0.75', unitCode: 't' });
    expect(created.json()).toMatchObject({ quantity: '0.75', unitCode: 't', quantityKg: '750' });
  });

  it('refuses units without a recorded weight instead of guessing', async () => {
    const { offer } = await trader();
    const response = await offer({ unitCode: 'crate' });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { path: string; code: string }[] }>().errors).toEqual([
      expect.objectContaining({ path: 'unitCode', code: 'no_weight' }),
    ]);
    expect((await offer({ unitCode: 'barrel' })).statusCode).toBe(400);
    expect((await offer({ quantity: '0.0001', unitCode: 'g' })).statusCode).toBe(400);
  });

  it('needs a supplier, an active item, an origin and ordered dates', async () => {
    const { client, base, offer } = await trader();
    const buyer = await client.request('POST', `${base}/partners`, {
      body: { kind: 'business', name: 'Buyer Only', roles: ['buyer'] },
    });
    const notSupplier = await offer({ partnerId: buyer.json<{ id: string }>().id });
    expect(notSupplier.statusCode).toBe(400);
    expect(notSupplier.json<{ errors: { code: string }[] }>().errors[0]?.code).toBe('not_supplier');

    const unknownOrigin = await client.request('POST', `${base}/partners`, {
      body: { kind: 'individual', name: 'Unknown Origin', roles: ['supplier'] },
    });
    const noOrigin = await offer({ partnerId: unknownOrigin.json<{ id: string }>().id });
    expect(noOrigin.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('origin');
    expect(
      (await offer({ partnerId: unknownOrigin.json<{ id: string }>().id, origin: 'farmed' }))
        .statusCode,
    ).toBe(201);

    const backwards = await offer({ availableFrom: '2026-11-20', availableUntil: '2026-11-19' });
    expect(backwards.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('availableUntil');
    expect((await offer({ availableFrom: '20/11/2026' })).statusCode).toBe(400);
    expect((await offer({ quantity: '0' })).statusCode).toBe(400);
    expect(
      (await offer({ catalogueItemId: '018f0000-0000-7000-8000-000000000000' })).statusCode,
    ).toBe(400);
  });

  it("respects the currency's decimals (UGX has none)", async () => {
    const { offer } = await trader('UG');
    expect((await offer({ askingPrice: '3500' })).json()).toMatchObject({
      askingPrice: '3500',
      currency: 'UGX',
    });
    const response = await offer({ askingPrice: '3500.50' });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ errors: { code: string }[] }>().errors[0]?.code).toBe('too_precise');
  });
});

describe('supply status', () => {
  it('reserves, releases, edits and withdraws with version checks', async () => {
    const { client, url, offer } = await trader();
    const record = (await offer()).json<Supply>();
    const one = `${url}/${record.id}`;

    const reserved = await client.request('PATCH', one, {
      body: { version: 1, status: 'reserved' },
    });
    expect(reserved.json()).toMatchObject({ status: 'reserved', version: 2 });

    const edited = await client.request('PATCH', one, {
      body: { version: 2, quantity: '3', askingPrice: '1200', status: 'available' },
    });
    expect(edited.json()).toMatchObject({
      quantity: '3',
      quantityKg: '55.5',
      askingPrice: '1200.00',
      status: 'available',
      version: 3,
    });

    const stale = await client.request('PATCH', one, { body: { version: 2, notes: 'late' } });
    expect(stale.statusCode).toBe(412);

    const purchased = await client.request('PATCH', one, {
      body: { version: 3, status: 'purchased' },
    });
    expect(purchased.statusCode).toBe(400); // only purchases set "purchased"

    const withdrawn = await client.request('PATCH', one, {
      body: { version: 3, status: 'withdrawn' },
    });
    expect(withdrawn.json()).toMatchObject({ status: 'withdrawn', version: 4 });
    const again = await client.request('PATCH', one, {
      body: { version: 4, status: 'available' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'SUPPLY_RECORD_CLOSED' });
  });

  it('lists open offers by default, filters, and marks past offers as expired', async () => {
    const { client, base, url, offer, itemId } = await trader();
    const perch = await client.request('POST', `${base}/catalogue-items`, {
      body: {
        speciesId: perchId,
        productFormCode: 'fresh_whole',
        defaultUnitCode: 'kg',
        units: [],
      },
    });
    await offer({ availableFrom: '2026-01-01', availableUntil: '2026-01-02' });
    await offer({ catalogueItemId: perch.json<{ id: string }>().id, quantity: '120' });
    const gone = (await offer()).json<Supply>();
    await client.request('PATCH', `${url}/${gone.id}`, {
      body: { version: 1, status: 'withdrawn' },
    });

    const open = (await client.request('GET', url)).json<Supply[]>();
    expect(open).toHaveLength(2);
    expect(open.find((r) => r.availableUntil === '2026-01-02')?.expired).toBe(true);
    expect((await client.request('GET', `${url}?state=closed`)).json<Supply[]>()).toHaveLength(1);
    expect((await client.request('GET', `${url}?state=all`)).json<Supply[]>()).toHaveLength(3);
    expect(
      (await client.request('GET', `${url}?catalogueItemId=${itemId}`)).json<Supply[]>(),
    ).toHaveLength(1);
    expect((await client.request('GET', `${url}?origin=farmed`)).json<Supply[]>()).toHaveLength(0);
  });
});

describe('access', () => {
  it('viewers can read supply but not record it', async () => {
    const { client: owner, base, url, offer } = await trader();
    await offer();
    const viewerPhone = nextPhone();
    await owner.request('POST', `${base}/members/invitations`, {
      body: { phone: viewerPhone, displayName: 'Viewer', roleKeys: ['viewer'] },
    });
    const viewer = new Client(app);
    await signIn(viewer, sms, viewerPhone);
    await viewer.request('POST', `/v1/me/invitations/${base.split('/').pop()}/accept`);

    expect((await viewer.request('GET', url)).json<Supply[]>()).toHaveLength(1);
    const create = await viewer.request('POST', url, { body: {} });
    expect(create.statusCode).toBe(403);
  });

  it("can't see or use another organisation's supply, partners or items", async () => {
    const a = await trader();
    const b = await trader();
    const record = (await a.offer()).json<Supply>();
    expect((await b.client.request('GET', a.url)).statusCode).toBe(404);
    expect(
      (await b.client.request('PATCH', `${b.url}/${record.id}`, { body: { version: 1 } }))
        .statusCode,
    ).toBe(404);
    // B referencing A's partner and item from B's own route: unknown under RLS.
    const borrowed = await b.client.request('POST', b.url, {
      body: {
        partnerId: a.partnerId,
        catalogueItemId: a.itemId,
        quantity: '1',
        availableFrom: '2026-11-20',
      },
    });
    expect(borrowed.statusCode).toBe(400);
  });
});

describe('todayIn', () => {
  it("uses the organisation's timezone, not the server's", () => {
    const lateUtc = new Date('2026-11-25T22:30:00Z'); // 01:30 on the 26th in Nairobi
    expect(todayIn('Africa/Nairobi', lateUtc)).toBe('2026-11-26');
    expect(todayIn('UTC', lateUtc)).toBe('2026-11-25');
  });
});
