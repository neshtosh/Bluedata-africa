// SamakiOS purchases and stock over HTTP: spot purchases received at once, drafts confirmed
// later, exact money and kg, document numbers, batches, the stock ledger, supply offers taken
// up, validation, permissions and tenant isolation.
import { createDatabase, inventoryMovements, type DatabaseHandle } from '@blue/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SMS_SENDER, type SmsSender } from '../src/platform/identity/sms-sender.js';
import { daysBefore } from '../src/samakios/purchases/inventory.service.js';
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
let admin: DatabaseHandle;
let counter = 0;
const nextPhone = () => `+2547${String(30_000_000 + ++counter).slice(-8)}`;
const year = () => todayIn('Africa/Nairobi').slice(0, 4);

interface Line {
  supplyRecordId: string | null;
  origin: string;
  quantity: string;
  unitCode: string;
  quantityKg: string;
  unitPrice: string;
  lineTotal: string;
  batch: { id: string; number: string } | null;
}
interface Purchase {
  id: string;
  number: string;
  status: string;
  purchaseDate: string;
  total: string;
  totalKg: string;
  currency: string;
  location: string | null;
  lines: Line[];
  version: number;
}
interface Batch {
  number: string;
  catchOrHarvestDate: string;
  quantityKgReceived: string;
  quantityKgOnHand: string;
  cost: string;
  costPerKg: string;
  purchase: { number: string } | null;
}
let omenaId: string;
let perchId: string;

/** A Kenyan trader with omena (basin = 18.5 kg), Nile perch (by kg) and a wild supplier. */
async function trader(countryCode = 'KE') {
  const client = new Client(app);
  await signIn(client, sms, nextPhone());
  const org = await client.request('POST', '/v1/orgs', {
    body: {
      legalName: `Purchase Co ${++counter}`,
      slug: `purchase-co-${Date.now().toString(36)}-${counter}`,
      countryCode,
      organisationTypes: ['trader_aggregator'],
    },
  });
  const orgId = org.json<{ id: string }>().id;
  const base = `/v1/orgs/${orgId}`;
  const post = async (path: string, body: unknown) => {
    const response = await client.request('POST', `${base}${path}`, { body });
    if (response.statusCode >= 300) throw new Error(`${path}: ${response.body}`);
    return response.json<{ id: string }>().id;
  };
  const omena = await post('/catalogue-items', {
    speciesId: omenaId,
    productFormCode: 'sun_dried',
    defaultUnitCode: 'basin',
    units: [{ unitCode: 'basin', kgPerUnit: '18.5' }],
  });
  const perch = await post('/catalogue-items', {
    speciesId: perchId,
    productFormCode: 'fresh_whole',
    defaultUnitCode: 'kg',
    units: [],
  });
  const supplier = await post('/partners', {
    kind: 'bmu',
    name: 'Dunga BMU',
    roles: ['supplier'],
    productionType: 'wild',
    landingSite: 'Dunga',
  });
  const url = `${base}/purchases`;
  const buy = (body: Record<string, unknown>) =>
    client.request('POST', url, { body: { partnerId: supplier, ...body } });
  const get = async <T>(path: string) => (await client.request('GET', `${base}${path}`)).json<T>();
  return { client, orgId, base, url, buy, get, post, omena, perch, supplier };
}

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  sms = vi.spyOn(app.get<SmsSender>(SMS_SENDER), 'send');
  admin = createDatabase(env.database.container.getConnectionUri(), { maxConnections: 1 });
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
  await admin?.close();
  await app?.close();
  await env?.stop();
});

describe('spot purchases', () => {
  it('receives a two-line purchase into stock with exact money, kg, numbers and batches', async () => {
    const t = await trader();
    const response = await t.buy({
      lines: [
        { catalogueItemId: t.omena, quantity: '2.5', unitPrice: '1800' },
        { catalogueItemId: t.perch, quantity: '40.5', unitPrice: '350.50' },
      ],
    });
    expect(response.statusCode).toBe(201);
    const purchase = response.json<Purchase>();
    expect(purchase).toMatchObject({
      number: `PO-${year()}-000001`,
      status: 'confirmed',
      purchaseDate: todayIn('Africa/Nairobi'),
      currency: 'KES',
      total: '18695.25', // 2.5 × 1800 + 40.5 × 350.50
      totalKg: '86.75', // 2.5 basins × 18.5 kg + 40.5 kg
      location: 'Dunga', // the supplier's landing site
      version: 2, // created, then confirmed
    });
    expect(purchase.lines).toEqual([
      expect.objectContaining({
        origin: 'wild',
        quantity: '2.5',
        unitCode: 'basin',
        quantityKg: '46.25',
        unitPrice: '1800.00',
        lineTotal: '4500.00',
        batch: expect.objectContaining({ number: `B-${year()}-000001` }),
      }),
      expect.objectContaining({
        unitCode: 'kg',
        quantityKg: '40.5',
        lineTotal: '14195.25',
        batch: expect.objectContaining({ number: `B-${year()}-000002` }),
      }),
    ]);

    const batches = await t.get<Batch[]>('/inventory/batches');
    expect(batches).toHaveLength(2);
    const omenaBatch = batches.find((b) => b.number.endsWith('000001'));
    expect(omenaBatch).toMatchObject({
      quantityKgReceived: '46.25',
      quantityKgOnHand: '46.25',
      cost: '4500.00',
      costPerKg: '97.30', // 4500 / 46.25 = 97.297…, rounded to the cent for display
      purchase: { number: purchase.number },
    });

    const summary = await t.get<Record<string, unknown>>('/inventory/summary');
    expect(summary).toMatchObject({
      currency: 'KES',
      onHandKg: '86.75',
      onHandCost: '18695.25',
      purchasesLast7Days: { count: 1, total: '18695.25' },
    });

    const second = (
      await t.buy({ lines: [{ catalogueItemId: t.perch, quantity: '1', unitPrice: '300' }] })
    ).json<Purchase>();
    expect(second.number).toBe(`PO-${year()}-000002`);
    expect(second.lines[0]?.batch?.number).toBe(`B-${year()}-000003`);
  });

  it('writes one receipt per batch to the append-only stock ledger', async () => {
    const t = await trader();
    const purchase = (
      await t.buy({ lines: [{ catalogueItemId: t.perch, quantity: '12.345', unitPrice: '0' }] })
    ).json<Purchase>();
    const movements = await admin.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.referenceId, purchase.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      movementType: 'receipt',
      quantityKg: '12.345',
      referenceType: 'purchase',
      batchId: purchase.lines[0]?.batch?.id,
    });
  });

  it('uses whole shillings in Uganda and refuses cents', async () => {
    const t = await trader('UG');
    const ok = await t.buy({
      lines: [{ catalogueItemId: t.perch, quantity: '10', unitPrice: '9500' }],
    });
    expect(ok.json()).toMatchObject({ currency: 'UGX', total: '95000' });
    const cents = await t.buy({
      lines: [{ catalogueItemId: t.perch, quantity: '10', unitPrice: '9500.5' }],
    });
    expect(cents.statusCode).toBe(400);
    expect(cents.json<{ errors: { path: string; code: string }[] }>().errors).toEqual([
      expect.objectContaining({ path: 'lines.0.unitPrice', code: 'too_precise' }),
    ]);
  });
});

describe('planned purchases', () => {
  it('keeps a draft out of stock until it is confirmed, once', async () => {
    const t = await trader();
    const draft = (
      await t.buy({
        receiveNow: false,
        purchaseDate: daysBefore(todayIn('Africa/Nairobi'), -3), // planned for later
        lines: [{ catalogueItemId: t.omena, quantity: '4', unitPrice: '1700' }],
      })
    ).json<Purchase>();
    expect(draft).toMatchObject({ status: 'draft', version: 1 });
    expect(draft.lines[0]?.batch).toBeNull();
    expect(await t.get<Batch[]>('/inventory/batches')).toHaveLength(0);

    const stale = await t.client.request('POST', `${t.url}/${draft.id}/confirm`, {
      body: { version: 7 },
    });
    expect(stale.statusCode).toBe(412);

    const confirmed = await t.client.request('POST', `${t.url}/${draft.id}/confirm`, {
      body: { version: 1 },
    });
    expect(confirmed.json()).toMatchObject({ status: 'confirmed', version: 2 });
    expect(await t.get<Batch[]>('/inventory/batches')).toHaveLength(1);

    const again = await t.client.request('POST', `${t.url}/${draft.id}/confirm`, {
      body: { version: 2 },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'PURCHASE_NOT_DRAFT' });
    expect(await t.get<Batch[]>('/inventory/batches')).toHaveLength(1);
  });

  it('cancels drafts but never confirmed purchases', async () => {
    const t = await trader();
    const draft = (
      await t.buy({
        receiveNow: false,
        lines: [{ catalogueItemId: t.perch, quantity: '5', unitPrice: '300' }],
      })
    ).json<Purchase>();
    const cancelled = await t.client.request('POST', `${t.url}/${draft.id}/cancel`, {
      body: { version: 1 },
    });
    expect(cancelled.json()).toMatchObject({ status: 'cancelled', version: 2 });

    const spot = (
      await t.buy({ lines: [{ catalogueItemId: t.perch, quantity: '5', unitPrice: '300' }] })
    ).json<Purchase>();
    const refused = await t.client.request('POST', `${t.url}/${spot.id}/cancel`, {
      body: { version: spot.version },
    });
    expect(refused.statusCode).toBe(409);

    const list = await t.get<Purchase[]>('/purchases?status=cancelled');
    expect(list.map((p) => p.id)).toEqual([draft.id]);
  });
});

describe('supply offers', () => {
  it('takes up an offer: its unit, origin and landing date carry over, and it becomes purchased', async () => {
    const t = await trader();
    const offer = await t.post('/supply-records', {
      partnerId: t.supplier,
      catalogueItemId: t.omena,
      quantity: '3',
      availableFrom: daysBefore(todayIn('Africa/Nairobi'), 1),
      origin: 'farmed',
    });
    const purchase = (
      await t.buy({
        lines: [
          { catalogueItemId: t.omena, quantity: '3', unitPrice: '1750', supplyRecordId: offer },
        ],
      })
    ).json<Purchase>();
    expect(purchase.lines[0]).toMatchObject({
      supplyRecordId: offer,
      origin: 'farmed', // from the offer, not the supplier's "wild"
      unitCode: 'basin',
      quantityKg: '55.5',
    });
    const [batch] = await t.get<Batch[]>('/inventory/batches');
    expect(batch?.catchOrHarvestDate).toBe(daysBefore(todayIn('Africa/Nairobi'), 1));

    const records = await t.get<{ id: string; status: string }[]>('/supply-records?state=all');
    expect(records.find((r) => r.id === offer)?.status).toBe('purchased');

    const twice = await t.buy({
      lines: [
        { catalogueItemId: t.omena, quantity: '1', unitPrice: '1750', supplyRecordId: offer },
      ],
    });
    expect(twice.statusCode).toBe(400);
    expect(twice.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe(
      'lines.0.supplyRecordId',
    );
  });

  it('a draft holds an offer until it is cancelled', async () => {
    const t = await trader();
    const offer = await t.post('/supply-records', {
      partnerId: t.supplier,
      catalogueItemId: t.perch,
      quantity: '100',
      availableFrom: todayIn('Africa/Nairobi'),
    });
    const line = {
      catalogueItemId: t.perch,
      quantity: '100',
      unitPrice: '320',
      supplyRecordId: offer,
    };
    const draft = (await t.buy({ receiveNow: false, lines: [line] })).json<Purchase>();
    expect((await t.buy({ lines: [line] })).statusCode).toBe(400);
    await t.client.request('POST', `${t.url}/${draft.id}/cancel`, { body: { version: 1 } });
    expect((await t.buy({ lines: [line] })).statusCode).toBe(201);
  });
});

describe('validation', () => {
  it('needs a supplier, known items, an origin and a sensible date', async () => {
    const t = await trader();
    const errorsOf = async (body: Record<string, unknown>) => {
      const response = await t.buy(body);
      expect(response.statusCode).toBe(400);
      return response.json<{ errors: { path: string; code: string }[] }>().errors;
    };
    const buyer = await t.post('/partners', { kind: 'business', name: 'Buyer', roles: ['buyer'] });
    expect(
      await errorsOf({
        partnerId: buyer,
        lines: [{ catalogueItemId: t.perch, quantity: '1', unitPrice: '1' }],
      }),
    ).toEqual(
      // Every problem is reported at once: not a supplier, and no origin to fall back on.
      expect.arrayContaining([
        expect.objectContaining({ path: 'partnerId', code: 'not_supplier' }),
      ]),
    );

    const unknownOrigin = await t.post('/partners', {
      kind: 'individual',
      name: 'Unknown origin',
      roles: ['supplier'],
    });
    expect(
      await errorsOf({
        partnerId: unknownOrigin,
        lines: [{ catalogueItemId: t.perch, quantity: '1', unitPrice: '1' }],
      }),
    ).toEqual([expect.objectContaining({ path: 'lines.0.origin', code: 'required' })]);

    expect(
      await errorsOf({
        purchaseDate: daysBefore(todayIn('Africa/Nairobi'), -1),
        lines: [{ catalogueItemId: t.perch, quantity: '1', unitPrice: '1' }],
      }),
    ).toEqual([expect.objectContaining({ path: 'purchaseDate', code: 'in_future' })]);

    expect(
      await errorsOf({
        lines: [
          {
            catalogueItemId: '018f0000-0000-7000-8000-000000000000',
            quantity: '1',
            unitPrice: '1',
          },
        ],
      }),
    ).toEqual([expect.objectContaining({ path: 'lines.0.catalogueItemId', code: 'unknown' })]);

    expect(
      await errorsOf({
        lines: [{ catalogueItemId: t.omena, quantity: '1', unitCode: 'crate', unitPrice: '1' }],
      }),
    ).toEqual([expect.objectContaining({ path: 'lines.0.unitCode', code: 'no_weight' })]);

    expect((await t.buy({ lines: [] })).statusCode).toBe(400);
    expect(await t.get<Purchase[]>('/purchases')).toHaveLength(0); // nothing half-saved
  });
});

describe('access', () => {
  it('viewers see purchases and stock but cannot buy', async () => {
    const t = await trader();
    await t.buy({ lines: [{ catalogueItemId: t.perch, quantity: '2', unitPrice: '300' }] });
    const viewerPhone = nextPhone();
    await t.client.request('POST', `${t.base}/members/invitations`, {
      body: { phone: viewerPhone, displayName: 'Viewer', roleKeys: ['viewer'] },
    });
    const viewer = new Client(app);
    await signIn(viewer, sms, viewerPhone);
    await viewer.request('POST', `/v1/me/invitations/${t.orgId}/accept`);

    expect((await viewer.request('GET', t.url)).json<Purchase[]>()).toHaveLength(1);
    expect((await viewer.request('GET', `${t.base}/inventory/summary`)).statusCode).toBe(200);
    const buy = await viewer.request('POST', t.url, {
      body: {
        partnerId: t.supplier,
        lines: [{ catalogueItemId: t.perch, quantity: '1', unitPrice: '1' }],
      },
    });
    expect(buy.statusCode).toBe(403);
  });

  it("can't see, confirm or buy against another organisation's records", async () => {
    const a = await trader();
    const b = await trader();
    const draft = (
      await a.buy({
        receiveNow: false,
        lines: [{ catalogueItemId: a.perch, quantity: '1', unitPrice: '1' }],
      })
    ).json<Purchase>();
    expect((await b.client.request('GET', a.url)).statusCode).toBe(404);
    const confirm = await b.client.request('POST', `${b.url}/${draft.id}/confirm`, {
      body: { version: 1 },
    });
    expect(confirm.statusCode).toBe(404);
    const borrowed = await b.client.request('POST', b.url, {
      body: {
        partnerId: a.supplier,
        lines: [{ catalogueItemId: a.perch, quantity: '1', unitPrice: '1' }],
      },
    });
    expect(borrowed.statusCode).toBe(400);
    expect(await b.get<Batch[]>('/inventory/batches')).toHaveLength(0);
  });
});
