// Authentication through the real HTTP API: OTP sign-up/sign-in, sessions, passwords, CSRF,
// rate limits — and what is (not) stored in the database.
import { otpChallenges, sessions } from '@blue/database';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SMS_SENDER, type SmsSender } from '../src/platform/identity/sms-sender.js';
import { Client, lastCodeSentTo, sessionCookieFrom, signIn } from './helpers/http-client.js';
import {
  startApp,
  startTestEnvironment,
  type TestEnvironment,
} from './helpers/test-environment.js';

let env: TestEnvironment;
let app: NestFastifyApplication;
let sms: MockInstance<SmsSender['send']>;
let phoneCounter = 0;
const nextPhone = () => `+2547${String(10_000_000 + ++phoneCounter).slice(-8)}`;

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  sms = vi.spyOn(app.get<SmsSender>(SMS_SENDER), 'send');
});

afterAll(async () => {
  await app?.close();
  await env?.stop();
});

async function requestCode(client: Client, phone: string) {
  const response = await client.request('POST', '/v1/auth/otp/request', { body: { phone } });
  expect(response.statusCode).toBe(202);
  return {
    challengeId: response.json<{ challengeId: string }>().challengeId,
    code: lastCodeSentTo(sms, phone),
  };
}

describe('OTP sign-up and sign-in', () => {
  it('creates the account on first sign-in and sets an HttpOnly session cookie', async () => {
    const client = new Client(app);
    const phone = nextPhone();
    const { challengeId, code } = await requestCode(client, phone);

    const withoutName = await client.request('POST', '/v1/auth/otp/verify', {
      body: { challengeId, phone, code },
    });
    expect(withoutName.statusCode).toBe(422);
    expect(withoutName.json()).toMatchObject({ code: 'DISPLAY_NAME_REQUIRED' });

    const verified = await client.request('POST', '/v1/auth/otp/verify', {
      body: { challengeId, phone, code, displayName: 'Achieng Otieno' },
    });
    expect(verified.statusCode).toBe(200);
    const setCookie = String(verified.headers['set-cookie']);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(verified.json()).toMatchObject({ user: { displayName: 'Achieng Otieno' } });
    expect(verified.body).not.toMatch(/blue_session|token/i); // token only in the cookie

    client.cookie = sessionCookieFrom(verified.headers['set-cookie']);
    const me = await client.request('GET', '/v1/me');
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { displayName: 'Achieng Otieno', phone, hasPassword: false },
      organisations: [],
    });
  });

  it('signs an existing user in without asking for a name again', async () => {
    const phone = nextPhone();
    await signIn(new Client(app), sms, phone, 'Wanjiru');
    const second = new Client(app);
    const { challengeId, code } = await requestCode(second, phone);
    const verified = await second.request('POST', '/v1/auth/otp/verify', {
      body: { challengeId, phone, code },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ user: { displayName: 'Wanjiru' } });
  });

  it('rejects a reused code, a code for another number, and an unknown challenge — identically', async () => {
    const client = new Client(app);
    const phone = nextPhone();
    const { challengeId, code } = await requestCode(client, phone);
    const otherNumber = await client.request('POST', '/v1/auth/otp/verify', {
      body: { challengeId, phone: nextPhone(), code, displayName: 'X' },
    });
    const ok = await client.request('POST', '/v1/auth/otp/verify', {
      body: { challengeId, phone, code, displayName: 'X' },
    });
    const reused = await client.request('POST', '/v1/auth/otp/verify', {
      body: { challengeId, phone, code },
    });
    const unknown = await client.request('POST', '/v1/auth/otp/verify', {
      body: { challengeId: '01900000-0000-7000-8000-000000000000', phone, code },
    });
    expect(ok.statusCode).toBe(200);
    for (const failed of [otherNumber, reused, unknown]) {
      expect(failed.statusCode).toBe(400);
      expect(failed.json()).toMatchObject({
        code: 'OTP_INVALID',
        title: 'Invalid or expired code',
      });
    }
  });

  it('locks a challenge after the maximum number of wrong attempts, even for the right code', async () => {
    const client = new Client(app);
    const phone = nextPhone();
    const { challengeId, code } = await requestCode(client, phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < env.config.OTP_MAX_ATTEMPTS; i++) {
      const attempt = await client.request('POST', '/v1/auth/otp/verify', {
        body: { challengeId, phone, code: wrong },
      });
      expect(attempt.statusCode).toBe(400);
    }
    const right = await client.request('POST', '/v1/auth/otp/verify', {
      body: { challengeId, phone, code, displayName: 'X' },
    });
    expect(right.json()).toMatchObject({ code: 'OTP_INVALID' });
  });

  it('stores neither codes, phone numbers nor session tokens in plaintext', async () => {
    const client = new Client(app);
    const phone = nextPhone();
    const { code } = await requestCode(client, phone);
    await signIn(client, sms, phone);
    const token = client.cookie?.split('=')[1] ?? '';

    const db = env.database.runtime.db;
    const challengeDump = JSON.stringify(await db.select().from(otpChallenges));
    expect(challengeDump).not.toContain(phone);
    expect(challengeDump).not.toContain(code);
    const stored = await db.execute(sql`
      select
        (select count(*)::int from ${sessions} where token_hash = sha256(convert_to(${token}, 'UTF8'))) as hashed,
        (select count(*)::int from ${sessions} where token_hash = convert_to(${token}, 'UTF8')) as plain
    `);
    expect(stored.rows[0]).toEqual({ hashed: 1, plain: 0 });
  });
});

describe('sessions', () => {
  it('requires a valid session on signed-in routes', async () => {
    const anonymous = await new Client(app).request('GET', '/v1/me');
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
    const forged = await new Client(app).request('GET', '/v1/me', {
      cookie: 'blue_session=forged-token-value-1234567890',
    });
    expect(forged.statusCode).toBe(401);
  });

  it('logout revokes the session immediately', async () => {
    const client = new Client(app);
    await signIn(client, sms, nextPhone());
    const cookie = client.cookie;
    const logout = await client.request('POST', '/v1/auth/logout');
    expect(logout.statusCode).toBe(204);
    expect(String(logout.headers['set-cookie'])).toMatch(/Max-Age=0/);
    expect((await client.request('GET', '/v1/me', { cookie })).statusCode).toBe(401);
  });
});

describe('passwords', () => {
  it('can be set, used to sign in, and changing it signs out other sessions', async () => {
    const phone = nextPhone();
    const laptop = new Client(app);
    const phoneApp = new Client(app);
    await signIn(laptop, sms, phone);
    await signIn(phoneApp, sms, phone);

    const set = await laptop.request('PUT', '/v1/me/password', {
      body: { password: 'long enough secret' },
    });
    expect(set.statusCode).toBe(204);
    expect((await phoneApp.request('GET', '/v1/me')).statusCode).toBe(401); // other session revoked
    expect((await laptop.request('GET', '/v1/me')).statusCode).toBe(200); // current one kept

    const login = await new Client(app).request('POST', '/v1/auth/password/login', {
      body: { phone, password: 'long enough secret' },
    });
    expect(login.statusCode).toBe(200);
    expect(sessionCookieFrom(login.headers['set-cookie'])).not.toBeNull();
  });

  it('gives the same answer for a wrong password and an unknown number', async () => {
    const phone = nextPhone();
    const client = new Client(app);
    await signIn(client, sms, phone);
    await client.request('PUT', '/v1/me/password', { body: { password: 'long enough secret' } });

    const wrong = await new Client(app).request('POST', '/v1/auth/password/login', {
      body: { phone, password: 'nope' },
    });
    const unknown = await new Client(app).request('POST', '/v1/auth/password/login', {
      body: { phone: nextPhone(), password: 'nope' },
    });
    for (const response of [wrong, unknown]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
  });

  it('rejects short passwords', async () => {
    const client = new Client(app);
    await signIn(client, sms, nextPhone());
    const response = await client.request('PUT', '/v1/me/password', {
      body: { password: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('abuse protection', () => {
  it('rejects state-changing requests without the CSRF header', async () => {
    const response = await new Client(app).request('POST', '/v1/auth/otp/request', {
      body: { phone: nextPhone() },
      csrf: false,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'CSRF_HEADER_MISSING' });
  });

  it('rate-limits codes per phone number and says when to retry', async () => {
    const phone = nextPhone();
    const statuses: number[] = [];
    let last;
    for (let i = 0; i < 6; i++) {
      // A different client each time: the per-number limit applies regardless of IP.
      last = await new Client(app).request('POST', '/v1/auth/otp/request', { body: { phone } });
      statuses.push(last.statusCode);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
    expect(Number(last?.headers['retry-after'])).toBeGreaterThan(0);
  });
});
