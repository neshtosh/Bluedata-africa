// End-to-end checks of the HTTP kernel through the real bootstrap (createApp) with real PostGIS
// and Valkey: request IDs, problem+json errors, validation, request context, health checks.
import { isId } from '@blue/primitives';
import { Body, Controller, Get, Inject, Module, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../src/kernel/config/app-config.js';
import { RequestContext } from '../src/kernel/context/request-context.js';
import { TenantDatabase } from '../src/kernel/database/tenant-database.js';
import { AppError } from '../src/kernel/errors/app-error.js';
import { ZodValidationPipe } from '../src/kernel/validation/zod-validation.pipe.js';
import { Public } from '../src/platform/access/access-policy.js';
import {
  startApp,
  startTestEnvironment,
  type TestEnvironment,
} from './helpers/test-environment.js';

const CreateThingSchema = z.strictObject({
  name: z.string().min(1),
  quantityKg: z.number().positive(),
});

@Controller('test')
@Public()
class TestController {
  constructor(@Inject(TenantDatabase) private readonly tenantDb: TenantDatabase) {}

  @Post('things')
  create(@Body(new ZodValidationPipe(CreateThingSchema)) body: z.output<typeof CreateThingSchema>) {
    return body;
  }

  @Get('context')
  context() {
    return { requestId: RequestContext.require().requestId };
  }

  @Get('crash')
  crash() {
    throw new Error('connection to 10.0.3.7 failed: password authentication failed');
  }

  @Get('business-rule')
  businessRule() {
    throw new AppError({
      status: 422,
      code: 'INVENTORY_INSUFFICIENT_STOCK',
      title: 'Insufficient stock',
      detail: 'Batch has 18.000 kg available; 25.000 kg requested.',
    });
  }

  @Get('tenant-without-org')
  tenantWithoutOrg() {
    return this.tenantDb.inTenant(async () => 'unreachable');
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

let env: TestEnvironment;
let app: NestFastifyApplication;

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config, [TestModule]);
});

afterAll(async () => {
  await app?.close();
  await env?.stop();
});

describe('request IDs', () => {
  it('assigns a UUIDv7 request ID and returns it in X-Request-Id', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(isId(response.headers['x-request-id'])).toBe(true);
  });

  it('keeps a well-formed incoming request ID and replaces an unsafe one', async () => {
    const kept = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'lb-req-123456' },
    });
    expect(kept.headers['x-request-id']).toBe('lb-req-123456');

    const replaced = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { 'x-request-id': 'bad id\n<script>' },
    });
    expect(isId(replaced.headers['x-request-id'])).toBe(true);
  });

  it('makes the request ID available to handler code through the request context', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/test/context' });
    expect(response.json()).toEqual({ requestId: response.headers['x-request-id'] });
  });
});

describe('problem+json errors', () => {
  it('returns RFC 9457 problem details for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/does-not-exist?x=1' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      instance: '/v1/does-not-exist',
      requestId: response.headers['x-request-id'],
    });
  });

  it('passes business-rule errors through with their code and detail', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/test/business-rule' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'INVENTORY_INSUFFICIENT_STOCK',
      detail: 'Batch has 18.000 kg available; 25.000 kg requested.',
    });
  });

  it('hides internal details of unexpected errors behind an opaque 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/test/crash' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(response.body).not.toContain('10.0.3.7');
    expect(response.body).not.toContain('password');
  });

  it('treats malformed JSON as a 400 problem', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/test/things',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'test' },
      payload: '{"name": ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
  });

  it('refuses tenant data access when no organisation is in context (fails closed)', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/test/tenant-without-org' });
    expect(response.statusCode).toBe(500);
  });
});

describe('validation', () => {
  it('returns parsed input when valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/test/things',
      headers: { 'x-requested-with': 'test' },
      payload: { name: 'Nile perch', quantityKg: 12.5 },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ name: 'Nile perch', quantityKg: 12.5 });
  });

  it('reports every invalid field and rejects unknown fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/test/things',
      headers: { 'x-requested-with': 'test' },
      payload: { name: '', quantityKg: -1, organisationId: 'someone-else' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; errors: { path: string }[] }>();
    expect(body.code).toBe('VALIDATION_FAILED');
    const paths = body.errors.map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'quantityKg']));
    expect(body.errors.some((e) => e.path === '' || e.path.includes('organisationId'))).toBe(true);
  });
});

describe('health', () => {
  it('liveness and readiness are served outside /v1 and report dependencies', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.json()).toEqual({ status: 'ok' });

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok', checks: { database: 'ok', valkey: 'ok' } });
  });

  it('readiness reports 503 without leaking details when a dependency is down', async () => {
    const broken = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_RUNTIME_URL: env.config.DATABASE_RUNTIME_URL,
      VALKEY_URL: 'redis://127.0.0.1:1', // nothing listens here
      AUTH_SECRET: env.config.AUTH_SECRET,
    });
    const brokenApp = await startApp(broken);
    try {
      const response = await brokenApp.inject({ method: 'GET', url: '/health/ready' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 'NOT_READY',
        detail: 'Unavailable dependencies: valkey',
      });
    } finally {
      await brokenApp.close();
    }
  });
});
