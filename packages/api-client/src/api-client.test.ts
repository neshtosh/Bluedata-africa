import { endpoints, type Me, type OrganisationSummary } from '@blue/contracts';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ApiClient, ApiError } from './api-client.js';

const ORG_ID = '0192f1c0-0000-7000-8000-000000000001';
const organisation: OrganisationSummary = {
  id: ORG_ID,
  legalName: 'Lake Traders Ltd',
  tradingName: null,
  slug: 'lake-traders',
  countryCode: 'KE',
  defaultCurrency: 'KES',
};

function fakeFetch(status: number, body?: unknown, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: {
          'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
          ...headers,
        },
      }),
  );
}

const requestOf = (spy: ReturnType<typeof fakeFetch>) => {
  const [url, init] = spy.mock.calls[0] ?? [];
  return {
    url: String(url),
    init: init ?? {},
    headers: (init?.headers ?? {}) as Record<string, string>,
  };
};

describe('ApiClient', () => {
  it('builds the served URL with encoded path parameters and sends cookies', async () => {
    const fetch = fakeFetch(200, organisation);
    const api = new ApiClient({ baseUrl: 'http://api.test/', fetch });
    const result = await api.call(endpoints.orgs.get, { params: { orgId: ORG_ID } });
    expect(result).toEqual(organisation);
    const { url, init } = requestOf(fetch);
    expect(url).toBe(`http://api.test/v1/orgs/${ORG_ID}`);
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('GET');
  });

  it('adds CSRF and Idempotency-Key headers where the contract requires them', async () => {
    const fetch = fakeFetch(201, organisation);
    const api = new ApiClient({ baseUrl: 'http://api.test', fetch, clientName: 'samakios-web' });
    await api.call(endpoints.orgs.register, {
      body: {
        legalName: 'Lake Traders Ltd',
        slug: 'Lake-Traders',
        countryCode: 'KE',
        organisationTypes: ['processor'],
      },
    });
    const { headers, init } = requestOf(fetch);
    expect(headers['x-requested-with']).toBe('samakios-web');
    expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    // The contract's transforms run client-side: slug is lowercased before sending.
    expect(JSON.parse(String(init.body))).toMatchObject({ slug: 'lake-traders' });
  });

  it('reuses a caller-supplied idempotency key (offline retries)', async () => {
    const fetch = fakeFetch(201, organisation);
    const api = new ApiClient({ baseUrl: 'http://api.test', fetch });
    await api.call(
      endpoints.orgs.register,
      {
        body: {
          legalName: 'X Ltd',
          slug: 'x-ltd',
          countryCode: 'KE',
          organisationTypes: ['processor'],
        },
      },
      { idempotencyKey: 'queued-write-0001' },
    );
    expect(requestOf(fetch).headers['idempotency-key']).toBe('queued-write-0001');
  });

  it('sends no CSRF or idempotency headers on reads', async () => {
    const fetch = fakeFetch(200, { status: 'ok' });
    await new ApiClient({ baseUrl: 'http://api.test', fetch }).call(endpoints.health.live);
    const { url, headers } = requestOf(fetch);
    expect(url).toBe('http://api.test/health/live'); // unversioned
    expect(headers['x-requested-with']).toBeUndefined();
    expect(headers['idempotency-key']).toBeUndefined();
  });

  it('rejects invalid input before making a request', async () => {
    const fetch = fakeFetch(202, {});
    const api = new ApiClient({ baseUrl: 'http://api.test', fetch });
    await expect(
      api.call(endpoints.auth.requestOtp, { body: { phone: '0712345678' } }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns problem+json responses into ApiError with code and Retry-After', async () => {
    const problem = {
      type: 'urn:blue:problem:rate-limited',
      title: 'Too many requests',
      status: 429,
      code: 'RATE_LIMITED',
      detail: 'Try again in 42 seconds.',
      instance: '/v1/auth/otp/request',
      requestId: 'r1',
    };
    const api = new ApiClient({
      baseUrl: 'http://api.test',
      fetch: fakeFetch(429, problem, { 'retry-after': '42' }),
    });
    const error = await api
      .call(endpoints.auth.requestOtp, { body: { phone: '+254712345678' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 42,
      message: 'Try again in 42 seconds.',
    });
  });

  it('returns undefined for 204 responses', async () => {
    const api = new ApiClient({ baseUrl: 'http://api.test', fetch: fakeFetch(204) });
    await expect(api.call(endpoints.auth.logout)).resolves.toBeUndefined();
  });

  it('rejects responses that do not match the contract', async () => {
    const api = new ApiClient({
      baseUrl: 'http://api.test',
      fetch: fakeFetch(200, { id: 'not-a-uuid' }),
    });
    await expect(api.call(endpoints.orgs.get, { params: { orgId: ORG_ID } })).rejects.toThrow();
  });

  it('infers request and response types from the contract', () => {
    const api = new ApiClient({ baseUrl: 'http://api.test', fetch: fakeFetch(200, {}) });
    // Compile-time assertions only: type-checked by tsc, never executed.
    const typesOnly = () => {
      expectTypeOf(api.call(endpoints.me.get)).resolves.toEqualTypeOf<Me>();
      expectTypeOf(
        api.call(endpoints.orgs.get, { params: { orgId: ORG_ID } }),
      ).resolves.toEqualTypeOf<OrganisationSummary>();
      expectTypeOf(api.call(endpoints.auth.logout)).resolves.toBeUndefined();
      // @ts-expect-error — params are required for /orgs/:orgId
      void api.call(endpoints.orgs.get);
    };
    expect(typeof typesOnly).toBe('function');
  });
});
