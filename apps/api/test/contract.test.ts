// The API and its contract (@blue/contracts) cannot drift apart: every route comes from the
// registry, the registry is fully mounted, responses are validated, and openapi.json is current.
import { defineEndpoint, listEndpoints, type Endpoint as EndpointContract } from '@blue/contracts';
import { Controller, Module } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Endpoint, ENDPOINT_METADATA } from '../src/kernel/contract/endpoint.decorator.js';
import { apiControllers } from '../src/openapi/api-controllers.js';
import { buildOpenApi } from '../src/openapi/build-openapi.js';
import { readCommitted, serialize } from '../src/openapi/openapi-file.js';
import { ACCESS_POLICY, Public, type AccessPolicy } from '../src/platform/access/access-policy.js';
import {
  startApp,
  startTestEnvironment,
  type TestEnvironment,
} from './helpers/test-environment.js';

// A test-only endpoint whose handler returns more than its contract allows.
const leakyEndpoint = defineEndpoint({
  method: 'GET',
  path: '/test/leaky',
  summary: 'test',
  tags: ['test'],
  auth: 'public',
  idempotencyKey: 'none',
  response: z.object({ id: z.string(), name: z.string() }),
  status: 200,
});
const brokenEndpoint = defineEndpoint({ ...leakyEndpoint, path: '/test/broken' });

@Controller()
@Public()
class ContractTestController {
  @Endpoint(leakyEndpoint)
  leaky() {
    return { id: 'u1', name: 'Asha', secretHash: '$argon2id$v=19$…' };
  }

  @Endpoint(brokenEndpoint)
  broken() {
    return { id: 'u1' }; // missing name
  }
}

@Module({ controllers: [ContractTestController] })
class ContractTestModule {}

let env: TestEnvironment;
let app: NestFastifyApplication;

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config, [ContractTestModule]);
});

afterAll(async () => {
  await app?.close();
  await env?.stop();
});

function mountedControllers() {
  const controllers: (new (...args: never[]) => object)[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      if (wrapper.metatype && wrapper.metatype !== ContractTestController) {
        controllers.push(wrapper.metatype as new (...args: never[]) => object);
      }
    }
  }
  return controllers;
}

function routeHandlers(controller: new (...args: never[]) => object) {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => ({ name, handler: (controller.prototype as Record<string, unknown>)[name] }))
    .filter(
      (entry): entry is { name: string; handler: (...args: unknown[]) => unknown } =>
        typeof entry.handler === 'function' &&
        Reflect.getMetadata('method', entry.handler) !== undefined,
    );
}

describe('API ↔ contract', () => {
  it('the OpenAPI controller list matches the controllers the app actually mounts', () => {
    const names = (list: readonly { name: string }[]) => list.map((c) => c.name).sort();
    expect(names(mountedControllers())).toEqual(names(apiControllers()));
  });

  it('every route is mounted from the registry, and every registry endpoint is mounted once', () => {
    const registry = new Map(listEndpoints().map(({ id, endpoint }) => [endpoint, id]));
    const mounted: string[] = [];
    const notFromRegistry: string[] = [];
    for (const controller of mountedControllers()) {
      for (const { name, handler } of routeHandlers(controller)) {
        const endpoint = Reflect.getMetadata(ENDPOINT_METADATA, handler) as
          EndpointContract | undefined;
        const id = endpoint && registry.get(endpoint);
        if (id) mounted.push(id);
        else notFromRegistry.push(`${controller.name}.${name}`);
      }
    }
    expect(notFromRegistry).toEqual([]);
    expect(mounted.sort()).toEqual([...registry.values()].sort());
  });

  it("each route's access policy agrees with its contract's auth", () => {
    const reflector = app.get(Reflector);
    const mismatched: string[] = [];
    for (const controller of mountedControllers()) {
      for (const { name, handler } of routeHandlers(controller)) {
        const endpoint = Reflect.getMetadata(ENDPOINT_METADATA, handler) as EndpointContract;
        const policy = reflector.getAllAndOverride<AccessPolicy>(ACCESS_POLICY, [
          handler,
          controller,
        ]);
        if ((policy.kind === 'public') !== (endpoint.auth === 'public'))
          mismatched.push(`${controller.name}.${name}`);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('committed openapi.json matches the code (run `pnpm --filter @blue/api openapi:generate`)', () => {
    const committed = readCommitted();
    expect(committed, 'apps/api/openapi.json is missing').toBeDefined();
    expect(serialize(committed ?? { paths: {} })).toBe(serialize(buildOpenApi()));
  });

  it('serves the OpenAPI document outside production', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'Blue Ecosystem Platform API' },
    });
  });
});

describe('response contracts', () => {
  it('strip fields the contract does not declare', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/test/leaky' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: 'u1', name: 'Asha' });
    expect(response.body).not.toContain('argon2');
  });

  it('turn a response that violates its contract into an opaque 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/test/broken' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
