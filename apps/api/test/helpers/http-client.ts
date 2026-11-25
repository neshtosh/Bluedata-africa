import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@blue/primitives';
import { randomInt } from 'node:crypto';
import type { MockInstance } from 'vitest';
import type { SmsSender } from '../../src/platform/identity/sms-sender.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  /** Defaults to a fresh UUID on POST; pass null to omit, or a fixed value to test replays. */
  idempotencyKey?: string | null;
  csrf?: boolean;
  cookie?: string | null;
}

/**
 * A simulated browser client: its own IP (so per-IP rate limits don't leak between tests),
 * an optional session cookie, and the headers our API requires (CSRF, Idempotency-Key).
 */
export class Client {
  readonly ip = `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
  cookie: string | null = null;

  constructor(private readonly app: NestFastifyApplication) {}

  async request(method: Method, url: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = {};
    if (options.csrf ?? true) headers['x-requested-with'] = 'test-client';
    const cookie = options.cookie === undefined ? this.cookie : options.cookie;
    if (cookie) headers.cookie = cookie;
    const key =
      options.idempotencyKey === undefined
        ? method === 'POST'
          ? newId()
          : null
        : options.idempotencyKey;
    if (key) headers['idempotency-key'] = key;
    return this.app.inject({
      method,
      url,
      headers,
      remoteAddress: this.ip,
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });
  }
}

/** Extracts `blue_session=…` from a Set-Cookie header for reuse in later requests. */
export function sessionCookieFrom(setCookie: string | string[] | undefined): string | null {
  const header = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
  const match = /blue_session=([A-Za-z0-9_-]+)/.exec(header);
  return match ? `blue_session=${match[1]}` : null;
}

/** The most recent code texted to a number, read from the spied development SMS sender. */
export function lastCodeSentTo(spy: MockInstance<SmsSender['send']>, phone: string): string {
  const call = [...spy.mock.calls].reverse().find(([to]) => to === phone);
  const code = call ? /\b(\d{6})\b/.exec(call[1])?.[1] : undefined;
  if (!code) throw new Error(`no code was sent to ${phone}`);
  return code;
}

/** Full OTP sign-in (creating the account if needed); leaves the session cookie on the client. */
export async function signIn(
  client: Client,
  spy: MockInstance<SmsSender['send']>,
  phone: string,
  displayName = `User ${phone.slice(-4)}`,
): Promise<string> {
  const requested = await client.request('POST', '/v1/auth/otp/request', { body: { phone } });
  if (requested.statusCode !== 202) throw new Error(`otp request failed: ${requested.body}`);
  const { challengeId } = requested.json<{ challengeId: string }>();
  const verified = await client.request('POST', '/v1/auth/otp/verify', {
    body: { challengeId, phone, code: lastCodeSentTo(spy, phone), displayName },
  });
  if (verified.statusCode !== 200) throw new Error(`otp verify failed: ${verified.body}`);
  const cookie = sessionCookieFrom(verified.headers['set-cookie']);
  if (!cookie) throw new Error('no session cookie set');
  client.cookie = cookie;
  return verified.json<{ user: { id: string } }>().user.id;
}
