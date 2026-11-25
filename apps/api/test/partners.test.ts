// SamakiOS trading partners over HTTP: roles, duplicate phones, filters, species links,
// concurrency, archiving, permissions, tenant isolation and what the audit log keeps.
import { auditLog, createDatabase, type DatabaseHandle } from '@blue/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, asc, eq } from 'drizzle-orm';
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
const nextPhone = () => `+2567${String(10_000_000 + ++counter).slice(-8)}`;

interface Partner {
  id: string;
  name: string;
  phone: string | null;
  roles: string[];
  speciesIds: string[];
  archived: boolean;
  version: number;
}
let perchId: string;
let omenaId: string;

async function ownerWithOrg() {
  const client = new Client(app);
  await signIn(client, sms, nextPhone());
  const org = await client.request('POST', '/v1/orgs', {
    body: {
      legalName: `Partners Co ${++counter}`,
      slug: `partners-co-${Date.now().toString(36)}-${counter}`,
      countryCode: 'UG',
      organisationTypes: ['trader_aggregator'],
    },
  });
  const orgId = org.json<{ id: string }>().id;
  const url = `/v1/orgs/${orgId}/partners`;
  const add = (body: Record<string, unknown>) =>
    client.request('POST', url, { body: { kind: 'individual', roles: ['supplier'], ...body } });
  const names = async (query = '') =>
    (await client.request('GET', `${url}${query}`)).json<Partner[]>().map((p) => p.name);
  return { client, orgId, url, add, names };
}

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  sms = vi.spyOn(app.get<SmsSender>(SMS_SENDER), 'send');
  admin = createDatabase(env.database.container.getConnectionUri(), { maxConnections: 1 });
  const { client } = await ownerWithOrg();
  const species = (await client.request('GET', '/v1/ref/vocabulary')).json<{
    species: { id: string; scientificName: string }[];
  }>().species;
  const idOf = (scientificName: string) => {
    const found = species.find((s) => s.scientificName === scientificName);
    if (!found) throw new Error(`${scientificName} not seeded`);
    return found.id;
  };
  perchId = idOf('Lates niloticus');
  omenaId = idOf('Rastrineobola argentea');
});

afterAll(async () => {
  await admin?.close();
  await app?.close();
  await env?.stop();
});

describe('trading partners', () => {
  it('records a partner who is both a supplier and a buyer', async () => {
    const { add, client, url } = await ownerWithOrg();
    const created = await add({
      kind: 'bmu',
      name: '  Kasenyi BMU  ',
      phone: '+256772000111',
      roles: ['supplier', 'buyer'],
      productionType: 'wild',
      landingSite: 'Kasenyi',
      speciesIds: [perchId, omenaId, perchId],
    });
    expect(created.statusCode).toBe(201);
    const partner = created.json<Partner>();
    expect(partner).toMatchObject({
      kind: 'bmu',
      name: 'Kasenyi BMU',
      phone: '+256772000111',
      roles: ['supplier', 'buyer'],
      productionType: 'wild',
      landingSite: 'Kasenyi',
      notes: null,
      archived: false,
      version: 1,
    });
    expect([...partner.speciesIds].sort()).toEqual([perchId, omenaId].sort()); // duplicates collapsed

    const list = (await client.request('GET', url)).json<Partner[]>();
    expect(list).toHaveLength(1);
    expect(list[0]?.speciesIds).toHaveLength(2);
  });

  it('needs at least one role, a valid phone and known species', async () => {
    const { add } = await ownerWithOrg();
    expect((await add({ name: 'No Role', roles: [] })).statusCode).toBe(400);
    expect((await add({ name: 'Twice', roles: ['buyer', 'buyer'] })).statusCode).toBe(400);
    expect((await add({ name: 'Local Phone', phone: '0772000111' })).statusCode).toBe(400);
    expect((await add({ name: 'Extra', nationalId: '12345678' })).statusCode).toBe(400);

    const unknown = await add({
      name: 'Ghost Fish',
      speciesIds: ['018f0000-0000-7000-8000-000000000000'],
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<{ errors: { path: string; code: string }[] }>().errors).toEqual([
      expect.objectContaining({ path: 'speciesIds', code: 'unknown' }),
    ]);
  });

  it('refuses a second partner with the same phone and names the first', async () => {
    const { add } = await ownerWithOrg();
    await add({ name: 'Mama Akello', phone: '+256772000222' });
    const again = await add({ name: 'Akello M.', phone: '+256772000222', roles: ['buyer'] });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      code: 'PARTNER_PHONE_EXISTS',
      detail: expect.stringContaining('Mama Akello'),
    });
    // Partners without a phone never collide with each other.
    expect((await add({ name: 'No Phone One' })).statusCode).toBe(201);
    expect((await add({ name: 'No Phone Two' })).statusCode).toBe(201);
  });

  it('lets two organisations each keep the same person', async () => {
    const a = await ownerWithOrg();
    const b = await ownerWithOrg();
    expect((await a.add({ name: 'Shared', phone: '+256772000333' })).statusCode).toBe(201);
    expect((await b.add({ name: 'Shared', phone: '+256772000333' })).statusCode).toBe(201);
  });

  it('filters by role, species and search text', async () => {
    const { add, names } = await ownerWithOrg();
    await add({ name: 'Okello Fishers', phone: '+256772111999', speciesIds: [perchId] });
    await add({ name: 'Nakato Dried Fish', roles: ['buyer'], speciesIds: [omenaId] });
    await add({ name: 'Lake Haulage 100%', kind: 'business', roles: ['transporter'] });

    expect(await names()).toEqual(['Lake Haulage 100%', 'Nakato Dried Fish', 'Okello Fishers']);
    expect(await names('?role=supplier')).toEqual(['Okello Fishers']);
    expect(await names('?role=transporter')).toEqual(['Lake Haulage 100%']);
    expect(await names(`?speciesId=${omenaId}`)).toEqual(['Nakato Dried Fish']);
    expect(await names('?q=nakato')).toEqual(['Nakato Dried Fish']);
    expect(await names('?q=0772111')).toEqual(['Okello Fishers']); // local form of the phone
    expect(await names('?q=7')).toEqual([]); // too few digits to search phones
    expect(await names('?q=100%25')).toEqual(['Lake Haulage 100%']); // % is literal
    expect(await names('?q=%25')).toEqual(['Lake Haulage 100%']);
    expect(await names(`?role=buyer&speciesId=${perchId}`)).toEqual([]);
  });

  it('edits with a version check, replaces species, clears fields and archives', async () => {
    const { add, client, url, names } = await ownerWithOrg();
    const partner = (
      await add({ name: 'Edit Me', phone: '+256772000444', notes: 'x', speciesIds: [perchId] })
    ).json<Partner>();
    const one = `${url}/${partner.id}`;

    const edited = await client.request('PATCH', one, {
      body: { version: 1, roles: ['buyer'], phone: null, notes: null, speciesIds: [omenaId] },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      roles: ['buyer'],
      phone: null,
      notes: null,
      speciesIds: [omenaId],
      version: 2,
    });

    const renamed = await client.request('PATCH', one, { body: { version: 2, name: 'Edited' } });
    expect(renamed.json()).toMatchObject({ name: 'Edited', speciesIds: [omenaId], version: 3 });

    const stale = await client.request('PATCH', one, { body: { version: 1, name: 'Late' } });
    expect(stale.statusCode).toBe(412);
    expect(stale.json()).toMatchObject({ code: 'STALE_VERSION' });

    const noRole = await client.request('PATCH', one, { body: { version: 3, roles: [] } });
    expect(noRole.statusCode).toBe(400);

    const archived = await client.request('PATCH', one, { body: { version: 3, archived: true } });
    expect(archived.json()).toMatchObject({ archived: true, version: 4 });
    expect(await names()).toEqual([]);
    expect(await names('?includeArchived=true')).toEqual(['Edited']);
  });

  it("refuses to take another partner's phone on edit", async () => {
    const { add, client, url } = await ownerWithOrg();
    await add({ name: 'First', phone: '+256772000555' });
    const second = (await add({ name: 'Second' })).json<Partner>();
    const clash = await client.request('PATCH', `${url}/${second.id}`, {
      body: { version: 1, phone: '+256772000555' },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ code: 'PARTNER_PHONE_EXISTS' });
  });

  it('replays a retried create instead of adding a duplicate', async () => {
    const { client, url, names } = await ownerWithOrg();
    const body = { kind: 'individual', name: 'Retry', roles: ['supplier'] };
    const key = '018f0000-0000-7000-8000-00000000abcd';
    const first = await client.request('POST', url, { body, idempotencyKey: key });
    const second = await client.request('POST', url, { body, idempotencyKey: key });
    expect(second.json<Partner>().id).toBe(first.json<Partner>().id);
    expect(await names()).toEqual(['Retry']);
    expect((await client.request('POST', url, { body, idempotencyKey: null })).statusCode).toBe(
      400,
    );
  });

  it('keeps names and phone numbers out of the audit log', async () => {
    const { add, client, url, orgId } = await ownerWithOrg();
    const partner = (await add({ name: 'Private Person', phone: '+256772000666' })).json<Partner>();
    await client.request('PATCH', `${url}/${partner.id}`, {
      body: { version: 1, name: 'Private Person II' },
    });
    const rows = await admin.db
      .select({ action: auditLog.action, changes: auditLog.changes })
      .from(auditLog)
      .where(and(eq(auditLog.organisationId, orgId), eq(auditLog.entityType, 'trading_partner')))
      .orderBy(asc(auditLog.occurredAt));
    expect(rows.map((r) => r.action)).toEqual([
      'trading_partner.created',
      'trading_partner.updated',
    ]);
    const text = JSON.stringify(rows);
    expect(text).not.toContain('Private Person');
    expect(text).not.toContain('256772000666');
    expect(rows[1]?.changes).toEqual({ fields: ['name'] });
  });
});

describe('access', () => {
  it('viewers can read partners but not change them', async () => {
    const { client: owner, orgId, url, add } = await ownerWithOrg();
    const partner = (await add({ name: 'Read Only' })).json<Partner>();
    const viewerPhone = nextPhone();
    await owner.request('POST', `/v1/orgs/${orgId}/members/invitations`, {
      body: { phone: viewerPhone, displayName: 'Viewer', roleKeys: ['viewer'] },
    });
    const viewer = new Client(app);
    await signIn(viewer, sms, viewerPhone);
    await viewer.request('POST', `/v1/me/invitations/${orgId}/accept`);

    expect((await viewer.request('GET', url)).json<Partner[]>()).toHaveLength(1);
    const create = await viewer.request('POST', url, {
      body: { kind: 'individual', name: 'Nope', roles: ['buyer'] },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json()).toMatchObject({
      detail: 'Requires the samakios.partners.manage permission.',
    });
    const patch = await viewer.request('PATCH', `${url}/${partner.id}`, {
      body: { version: 1, archived: true },
    });
    expect(patch.statusCode).toBe(403);
  });

  it("another organisation's partners are invisible", async () => {
    const a = await ownerWithOrg();
    const b = await ownerWithOrg();
    const partner = (await a.add({ name: 'Mine', phone: '+256772000777' })).json<Partner>();
    expect((await b.client.request('GET', a.url)).statusCode).toBe(404);
    expect(await b.names('?q=Mine')).toEqual([]);
    const patch = await b.client.request('PATCH', `${b.url}/${partner.id}`, {
      body: { version: 1, name: 'Hijacked' },
    });
    expect(patch.statusCode).toBe(404); // B's own org route, A's partner id: not found under RLS
    expect(await a.names()).toEqual(['Mine']);
  });
});
