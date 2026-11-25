// The typed client (@blue/api-client) against the real API over real HTTP: proves client and
// server agree on the contract at runtime, not just at compile time.
import { ApiClient, ApiError } from '@blue/api-client';
import { endpoints } from '@blue/contracts';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SMS_SENDER, type SmsSender } from '../src/platform/identity/sms-sender.js';
import { lastCodeSentTo } from './helpers/http-client.js';
import {
  startApp,
  startTestEnvironment,
  type TestEnvironment,
} from './helpers/test-environment.js';

let env: TestEnvironment;
let app: NestFastifyApplication;
let sms: MockInstance<SmsSender['send']>;
let baseUrl: string;

/** What a browser does for us: keep the session cookie between requests. */
function browser(): ApiClient {
  let cookie: string | null = null;
  const cookieFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookie) headers.set('cookie', cookie);
    const response = await fetch(input, { ...init, headers });
    const session = response.headers.getSetCookie().find((c) => c.startsWith('blue_session='));
    if (session) cookie = session.split(';')[0] ?? null;
    return response;
  };
  return new ApiClient({ baseUrl, fetch: cookieFetch, clientName: 'e2e-test' });
}

async function signUp(api: ApiClient, phone: string, displayName: string) {
  const { challengeId } = await api.call(endpoints.auth.requestOtp, { body: { phone } });
  return api.call(endpoints.auth.verifyOtp, {
    body: { challengeId, phone, code: lastCodeSentTo(sms, phone), displayName },
  });
}

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  sms = vi.spyOn(app.get<SmsSender>(SMS_SENDER), 'send');
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  await env?.stop();
});

describe('typed client against the live API', () => {
  it('runs the sign-up → organisation → members journey', async () => {
    const api = browser();
    const session = await signUp(api, '+255711000001', 'Neema');
    expect(session.user.displayName).toBe('Neema');

    const empty = await api.call(endpoints.me.get);
    expect(empty.organisations).toEqual([]);

    const body = {
      legalName: 'Mwanza Fresh Fish',
      slug: 'Mwanza-Fresh-Fish', // the contract lowercases it
      countryCode: 'TZ',
      organisationTypes: ['processor', 'exporter'],
    };
    const org = await api.call(
      endpoints.orgs.register,
      { body },
      { idempotencyKey: 'e2e-register-0001' },
    );
    expect(org).toMatchObject({ slug: 'mwanza-fresh-fish', defaultCurrency: 'TZS' });

    // An offline-style retry with the same key returns the same organisation, not a second one.
    const retried = await api.call(
      endpoints.orgs.register,
      { body },
      { idempotencyKey: 'e2e-register-0001' },
    );
    expect(retried).toEqual(org);

    const me = await api.call(endpoints.me.get);
    expect(me.organisations).toEqual([
      expect.objectContaining({
        organisation: org,
        roles: ['owner'],
        products: ['bluedata', 'samakios'],
      }),
    ]);

    await api.call(endpoints.orgs.invite, {
      params: { orgId: org.id },
      body: { phone: '+255711000002', displayName: 'Juma', roleKeys: ['viewer'] },
    });
    const members = await api.call(endpoints.orgs.listMembers, { params: { orgId: org.id } });
    expect(members.map((m) => [m.displayName, m.status, m.roles])).toEqual(
      expect.arrayContaining([
        ['Neema', 'active', ['owner']],
        ['Juma', 'invited', ['viewer']],
      ]),
    );
  });

  it('surfaces API errors as ApiError with their problem code', async () => {
    const owner = browser();
    await signUp(owner, '+255711000003', 'Owner');
    const org = await owner.call(endpoints.orgs.register, {
      body: {
        legalName: 'Private Co',
        slug: 'private-co-e2e',
        countryCode: 'KE',
        organisationTypes: ['processor'],
      },
    });

    const outsider = browser();
    await signUp(outsider, '+255711000004', 'Outsider');
    const error = await outsider
      .call(endpoints.orgs.get, { params: { orgId: org.id } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('logout ends the session for the client', async () => {
    const api = browser();
    await signUp(api, '+255711000005', 'Leaving');
    await api.call(endpoints.auth.logout);
    const error = await api.call(endpoints.me.get).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });
});
