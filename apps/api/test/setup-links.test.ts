// Signing in without SMS (ADR-019): setup links created by organisation owners or the operator,
// redeemed by choosing a password; SMS sign-in switched off; the safety rules around links.
import { createDatabase, setupTokens, users, type DatabaseHandle } from '@blue/database';
import type { Id } from '@blue/primitives';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { issueSetupToken } from '../src/platform/identity/setup-tokens.js';
import { SMS_SENDER, type SmsSender } from '../src/platform/identity/sms-sender.js';
import { Client, sessionCookieFrom, signIn } from './helpers/http-client.js';
import {
  startApp,
  startTestEnvironment,
  type TestEnvironment,
} from './helpers/test-environment.js';

let env: TestEnvironment;
let app: NestFastifyApplication;
let smsOff: NestFastifyApplication;
let sms: MockInstance<SmsSender['send']>;
let admin: DatabaseHandle;
let counter = 0;
const nextPhone = () => `+2507${String(40_000_000 + ++counter).slice(-8)}`;
const PASSWORD = 'correct horse battery';
const tokenOf = (path: string) => path.split('#token=')[1] ?? '';

/** An owner with an organisation, who has invited a new person by phone. */
async function ownerWithInvitee(role: 'viewer' | 'admin' = 'viewer') {
  const owner = new Client(app);
  await signIn(owner, sms, nextPhone(), 'Owner');
  const org = await owner.request('POST', '/v1/orgs', {
    body: {
      legalName: `Setup Co ${++counter}`,
      slug: `setup-co-${Date.now().toString(36)}-${counter}`,
      countryCode: 'KE',
      organisationTypes: ['trader_aggregator'],
    },
  });
  const orgId = org.json<{ id: string }>().id;
  const inviteePhone = nextPhone();
  await owner.request('POST', `/v1/orgs/${orgId}/members/invitations`, {
    body: { phone: inviteePhone, displayName: 'Uwase', roleKeys: [role] },
  });
  const members = (await owner.request('GET', `/v1/orgs/${orgId}/members`)).json<
    { userId: string; displayName: string; status: string }[]
  >();
  const invitee = members.find((m) => m.displayName === 'Uwase');
  if (!invitee) throw new Error('invitee missing');
  const link = (userId = invitee.userId, client = owner) =>
    client.request('POST', `/v1/orgs/${orgId}/members/${userId}/setup-link`);
  return { owner, orgId, inviteePhone, inviteeId: invitee.userId, link };
}

/** Redeems a token from a fresh browser; returns that browser, signed in on success. */
async function redeem(token: string, body: Record<string, unknown> = {}) {
  const browser = new Client(app);
  const response = await browser.request('POST', '/v1/auth/setup', {
    body: { token, password: PASSWORD, ...body },
  });
  browser.cookie = sessionCookieFrom(response.headers['set-cookie']);
  return { browser, response };
}

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  smsOff = await startApp({ ...env.config, SMS_PROVIDER: 'none' });
  sms = vi.spyOn(app.get<SmsSender>(SMS_SENDER), 'send');
  admin = createDatabase(env.database.container.getConnectionUri(), { maxConnections: 1 });
});

afterAll(async () => {
  await admin?.close();
  await smsOff?.close();
  await app?.close();
  await env?.stop();
});

describe('sign-in methods', () => {
  it('says whether SMS codes are available, and refuses them when switched off', async () => {
    expect((await new Client(app).request('GET', '/v1/auth/methods')).json()).toEqual({
      otp: true,
      password: true,
    });
    const off = new Client(smsOff);
    expect((await off.request('GET', '/v1/auth/methods')).json()).toEqual({
      otp: false,
      password: true,
    });
    const request = await off.request('POST', '/v1/auth/otp/request', {
      body: { phone: nextPhone() },
    });
    expect(request.statusCode).toBe(503);
    expect(request.json()).toMatchObject({ code: 'SMS_UNAVAILABLE' });
  });
});

describe('setup links from an organisation', () => {
  it('lets an invited person choose a password, join the organisation and sign in later', async () => {
    const { link, orgId, inviteePhone } = await ownerWithInvitee();
    const created = await link();
    expect(created.statusCode).toBe(201);
    const { path } = created.json<{ path: string; expiresAt: string }>();
    expect(path).toMatch(/^\/setup#token=[A-Za-z0-9_-]{43}$/); // token only in the #fragment
    const token = tokenOf(path);

    const details = await new Client(app).request('POST', '/v1/auth/setup/inspect', {
      body: { token },
    });
    expect(details.json()).toMatchObject({
      phone: expect.stringMatching(/^\+250\*+\d\d$/), // masked
      displayName: 'Uwase',
      organisationName: expect.stringMatching(/^Setup Co/),
    });

    const short = await redeem(token, { password: 'short' });
    expect(short.response.statusCode).toBe(400); // the link survives a rejected password

    const { browser, response } = await redeem(token, { displayName: 'Uwase M.' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ user: { displayName: 'Uwase M.' } });
    // Opening the organisation's link accepted its invitation.
    expect((await browser.request('GET', `/v1/orgs/${orgId}/members`)).statusCode).toBe(200);

    expect((await redeem(token)).response.statusCode).toBe(404); // single use

    const later = await new Client(smsOff).request('POST', '/v1/auth/password/login', {
      body: { phone: inviteePhone, password: PASSWORD },
    });
    expect(later.statusCode).toBe(200);
  });

  it('only the latest link works, and none once the person has signed in', async () => {
    const { link } = await ownerWithInvitee();
    const first = tokenOf((await link()).json<{ path: string }>().path);
    const second = tokenOf((await link()).json<{ path: string }>().path);
    expect((await redeem(first)).response.statusCode).toBe(404);
    expect((await redeem(second)).response.statusCode).toBe(200);

    const again = await link();
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'SETUP_LINK_NOT_ALLOWED' });
  });

  it("can't target someone who already uses the platform, even if invited", async () => {
    const { owner, orgId } = await ownerWithInvitee();
    // Someone with their own account and organisation, invited here as well.
    const established = new Client(app);
    const phone = nextPhone();
    await signIn(established, sms, phone, 'Established');
    await owner.request('POST', `/v1/orgs/${orgId}/members/invitations`, {
      body: { phone, displayName: 'Established', roleKeys: ['viewer'] },
    });
    const [user] = await admin.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneE164, phone));
    const attempt = await owner.request('POST', `/v1/orgs/${orgId}/members/${user?.id}/setup-link`);
    expect(attempt.statusCode).toBe(409);
  });

  it('needs permission to manage members, and a member of this organisation', async () => {
    const a = await ownerWithInvitee();
    const b = await ownerWithInvitee();
    // B's owner asking for a link for A's invitee, through B's organisation.
    expect((await b.link(a.inviteeId)).statusCode).toBe(404);

    // A viewer of A can't create links.
    const viewerPhone = nextPhone();
    await a.owner.request('POST', `/v1/orgs/${a.orgId}/members/invitations`, {
      body: { phone: viewerPhone, displayName: 'Viewer', roleKeys: ['viewer'] },
    });
    const viewer = new Client(app);
    await signIn(viewer, sms, viewerPhone);
    await viewer.request('POST', `/v1/me/invitations/${a.orgId}/accept`);
    expect((await a.link(a.inviteeId, viewer)).statusCode).toBe(403);
  });

  it('expired links do not work', async () => {
    const { link, inviteeId } = await ownerWithInvitee();
    const token = tokenOf((await link()).json<{ path: string }>().path);
    await admin.db
      .update(setupTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(setupTokens.userId, inviteeId));
    const inspect = await new Client(app).request('POST', '/v1/auth/setup/inspect', {
      body: { token },
    });
    expect(inspect.statusCode).toBe(404);
    expect(inspect.json()).toMatchObject({ code: 'SETUP_LINK_INVALID' });
    expect((await redeem(token)).response.statusCode).toBe(404);
  });
});

describe('operator reset links', () => {
  it('replace the password and sign the person out everywhere else', async () => {
    const phone = nextPhone();
    const person = new Client(app);
    await signIn(person, sms, phone);
    expect((await person.request('GET', '/v1/me')).statusCode).toBe(200);

    const [user] = await admin.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneE164, phone));
    const { token } = await issueSetupToken(admin.db, env.config.AUTH_SECRET, 72, {
      userId: user?.id as Id,
    });
    const details = await new Client(app).request('POST', '/v1/auth/setup/inspect', {
      body: { token },
    });
    expect(details.json()).toMatchObject({ organisationName: null });

    const { browser, response } = await redeem(token);
    expect(response.statusCode).toBe(200);
    expect((await browser.request('GET', '/v1/me')).statusCode).toBe(200);
    expect((await person.request('GET', '/v1/me')).statusCode).toBe(401); // old session ended
  });

  it('rejects malformed tokens before touching the database', async () => {
    const response = await new Client(app).request('POST', '/v1/auth/setup', {
      body: { token: 'not-a-token', password: PASSWORD },
    });
    expect(response.statusCode).toBe(400);
  });
});
