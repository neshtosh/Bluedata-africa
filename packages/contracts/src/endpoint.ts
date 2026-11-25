import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One API endpoint, defined once and used everywhere (DECISIONS.md ADR-016):
 *   - the API mounts its route from it, so paths cannot drift from the contract;
 *   - the OpenAPI document is generated from it;
 *   - the typed client derives request and response types from it;
 *   - in development and tests, responses are checked against `response`.
 * Who may call it (permission, product) is enforced and documented by the API, not here.
 */
export interface Endpoint {
  readonly method: HttpMethod;
  /** Relative to /v1 unless `versioned` is false, with `:name` parameters, e.g. `/orgs/:orgId`. */
  readonly path: string;
  readonly versioned?: false;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly string[];
  /** `public` endpoints need no session; `session` endpoints need a signed-in user. */
  readonly auth: 'public' | 'session';
  /** Whether clients must send an Idempotency-Key (API.md §1). */
  readonly idempotencyKey: 'required' | 'none';
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  /** Absent = no response body (204). */
  readonly response?: z.ZodType;
  readonly status: 200 | 201 | 202 | 204;
}

/** Identity function that keeps literal types, so clients get exact input/output types. */
export function defineEndpoint<const E extends Endpoint>(endpoint: E): E {
  return endpoint;
}

type Infer<S, IO extends 'input' | 'output'> = S extends z.ZodType
  ? IO extends 'input'
    ? z.input<S>
    : z.output<S>
  : never;

/** What a caller passes: only the parts the endpoint actually has. */
export type EndpointInput<E extends Endpoint> = (E['params'] extends z.ZodType
  ? { params: Infer<E['params'], 'input'> }
  : { params?: never }) &
  (E['query'] extends z.ZodType ? { query: Infer<E['query'], 'input'> } : { query?: never }) &
  (E['body'] extends z.ZodType ? { body: Infer<E['body'], 'input'> } : { body?: never });

/** What a caller receives. */
export type EndpointOutput<E extends Endpoint> = E['response'] extends z.ZodType
  ? Infer<E['response'], 'output'>
  : undefined;

/** Full path as served, e.g. `/v1/orgs/:orgId`. */
export function servedPath(endpoint: Endpoint): string {
  return endpoint.versioned === false ? endpoint.path : `/v1${endpoint.path}`;
}
