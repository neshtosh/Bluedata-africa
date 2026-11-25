import { listEndpoints, ProblemDetailsSchema, servedPath, type Endpoint } from '@blue/contracts';
import { z } from 'zod';
import { ENDPOINT_METADATA } from '../kernel/contract/endpoint.decorator.js';
import { ACCESS_POLICY, type AccessPolicy } from '../platform/access/access-policy.js';
import { apiControllers } from './api-controllers.js';

type JsonSchema = Record<string, unknown>;
export type OpenApiDocument = Record<string, unknown> & {
  paths: Record<string, Record<string, unknown>>;
};

export const API_VERSION = '0.1.0';
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface Route {
  handlerName: string;
  endpoint: Endpoint;
  policy: AccessPolicy | undefined;
}

/** Every contract-mounted route, read from decorator metadata (no application boot needed). */
export function collectRoutes(
  controllers: readonly (new (...args: never[]) => object)[] = apiControllers(),
): Route[] {
  const routes: Route[] = [];
  for (const controller of controllers) {
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const endpoint = Reflect.getMetadata(ENDPOINT_METADATA, handler) as Endpoint | undefined;
      if (!endpoint) continue;
      const policy = (Reflect.getMetadata(ACCESS_POLICY, handler) ??
        Reflect.getMetadata(ACCESS_POLICY, controller)) as AccessPolicy | undefined;
      routes.push({ handlerName: `${controller.name}.${name}`, endpoint, policy });
    }
  }
  return routes;
}

/** Builds the OpenAPI 3.1 document. Deterministic: same code ⇒ byte-identical output. */
export function buildOpenApi(routes: Route[] = collectRoutes()): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  const sorted = [...routes].sort((a, b) =>
    `${servedPath(a.endpoint)} ${a.endpoint.method}`.localeCompare(
      `${servedPath(b.endpoint)} ${b.endpoint.method}`,
    ),
  );
  for (const route of sorted) {
    const path = servedPath(route.endpoint).replace(/:([A-Za-z]+)/g, '{$1}');
    paths[path] ??= {};
    paths[path][route.endpoint.method.toLowerCase()] = operation(route);
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Blue Ecosystem Platform API',
      version: API_VERSION,
      description:
        'Shared platform API for SamakiOS and BlueData Africa. Generated from @blue/contracts — do not edit by hand.',
    },
    servers: [{ url: '/' }],
    tags: [...new Set(sorted.flatMap((r) => r.endpoint.tags))].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        session: {
          type: 'apiKey',
          in: 'cookie',
          name: 'blue_session',
          description: 'Opaque session cookie set by sign-in.',
        },
      },
      schemas: { ProblemDetails: jsonSchema(ProblemDetailsSchema, 'output') },
    },
  };
}

function operation({ endpoint, policy }: Route): Record<string, unknown> {
  const parameters: JsonSchema[] = [];
  if (endpoint.params instanceof z.ZodObject) {
    for (const [name, schema] of Object.entries(
      endpoint.params.shape as Record<string, z.ZodType>,
    )) {
      parameters.push({ name, in: 'path', required: true, schema: jsonSchema(schema, 'input') });
    }
  }
  if (STATE_CHANGING.has(endpoint.method)) {
    parameters.push({
      name: 'X-Requested-With',
      in: 'header',
      required: true,
      description: 'Any value. CSRF protection for browser clients.',
      schema: { type: 'string' },
    });
  }
  if (endpoint.idempotencyKey === 'required') {
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      description:
        'Unique per logical request (e.g. a UUID). Retries with the same key replay the first response.',
      schema: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{8,128}$' },
    });
  }

  const success =
    endpoint.response === undefined
      ? { description: 'No content' }
      : {
          description: 'Success',
          content: { 'application/json': { schema: jsonSchema(endpoint.response, 'output') } },
        };

  return {
    operationId: endpointOperationId(endpoint),
    summary: endpoint.summary,
    ...(endpoint.description ? { description: endpoint.description } : {}),
    tags: [...endpoint.tags],
    security: endpoint.auth === 'public' ? [] : [{ session: [] }],
    ...(policy?.kind === 'permission' ? { 'x-permission': policy.permission } : {}),
    ...(policy?.kind === 'permission' && policy.product ? { 'x-product': policy.product } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(endpoint.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: jsonSchema(endpoint.body, 'input') } },
          },
        }
      : {}),
    responses: { [String(endpoint.status)]: success, ...errorResponses(endpoint, policy) },
  };
}

function errorResponses(
  endpoint: Endpoint,
  policy: AccessPolicy | undefined,
): Record<string, unknown> {
  const problem = (description: string) => ({
    description,
    content: {
      'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } },
    },
  });
  const responses: Record<string, unknown> = {};
  if (endpoint.body || endpoint.params || endpoint.idempotencyKey === 'required')
    responses['400'] = problem('Invalid request');
  if (endpoint.auth === 'session') responses['401'] = problem('Not signed in');
  if (policy?.kind === 'permission' || STATE_CHANGING.has(endpoint.method))
    responses['403'] = problem('Not permitted');
  if (policy?.kind === 'permission' || endpoint.params)
    responses['404'] = problem('Not found (or not visible to you)');
  if (endpoint.idempotencyKey === 'required')
    responses['409'] = problem('Conflict, or Idempotency-Key reused or in progress');
  if (endpoint.body) responses['422'] = problem('Request understood but violates a business rule');
  if (endpoint.auth === 'public' && STATE_CHANGING.has(endpoint.method))
    responses['429'] = problem('Rate limited (see Retry-After)');
  responses.default = problem('Unexpected error');
  return responses;
}

/** `orgs.listMembers` style ids, from the endpoint's place in the registry. */
function endpointOperationId(endpoint: Endpoint): string {
  const entry = listEndpoints().find((candidate) => candidate.endpoint === endpoint);
  if (!entry)
    throw new Error(`Endpoint ${endpoint.method} ${endpoint.path} is not in the registry`);
  return entry.id;
}

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const result = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  delete result.$schema; // embedded in OpenAPI, which declares the dialect itself
  return result;
}
