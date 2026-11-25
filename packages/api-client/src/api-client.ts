import {
  ProblemDetailsSchema,
  servedPath,
  type Endpoint,
  type EndpointInput,
  type EndpointOutput,
  type ProblemDetails,
} from '@blue/contracts';

/** An error response from the API, with its RFC 9457 problem details when available. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = 'ApiError';
  }

  /** Stable machine-readable code, e.g. OTP_INVALID, FORBIDDEN, RATE_LIMITED. */
  get code(): string {
    return this.problem?.code ?? `HTTP_${this.status}`;
  }
}

export interface ApiClientOptions {
  /** e.g. `https://api.example.africa` or `http://localhost:4000`. */
  baseUrl: string;
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Sent as X-Requested-With (CSRF header) on state-changing requests. */
  clientName?: string;
  /** Validate responses against their contract (default true). */
  validateResponses?: boolean;
}

export interface CallOptions {
  /**
   * Reuse the same key when retrying the same logical request (e.g. from an offline queue), so
   * the server replays instead of acting twice. Generated per call when omitted.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

type HasInput<E extends Endpoint> = E['params'] extends object
  ? true
  : E['query'] extends object
    ? true
    : E['body'] extends object
      ? true
      : false;

/** Input is required exactly when the endpoint has params, query or body. */
export type CallArgs<E extends Endpoint> =
  HasInput<E> extends true
    ? [input: EndpointInput<E>, options?: CallOptions]
    : [input?: EndpointInput<E>, options?: CallOptions];

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Calls API endpoints by their contract. Request and response types come from the endpoint's
 * Zod schemas, so the compiler catches mismatches. Uses cookies (credentials: 'include').
 */
export class ApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly clientName: string;
  private readonly validateResponses: boolean;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.clientName = options.clientName ?? 'blue-web';
    this.validateResponses = options.validateResponses ?? true;
  }

  async call<E extends Endpoint>(
    endpoint: E,
    ...[input, options]: CallArgs<E>
  ): Promise<EndpointOutput<E>> {
    const parts = (input ?? {}) as {
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    const url = this.url(endpoint, parts.params, parts.query);

    const headers: Record<string, string> = { accept: 'application/json' };
    let body: string | undefined;
    if (endpoint.body) {
      // Validate before sending: fails fast in forms and applies the contract's transforms.
      body = JSON.stringify(endpoint.body.parse(parts.body));
      headers['content-type'] = 'application/json';
    }
    if (STATE_CHANGING.has(endpoint.method)) headers['x-requested-with'] = this.clientName;
    if (endpoint.idempotencyKey === 'required') {
      headers['idempotency-key'] = options?.idempotencyKey ?? globalThis.crypto.randomUUID();
    }

    const response = await this.fetchImpl(url, {
      method: endpoint.method,
      headers,
      credentials: 'include',
      ...(body === undefined ? {} : { body }),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) throw await toApiError(response);
    if (!endpoint.response || response.status === 204) return undefined as EndpointOutput<E>;
    const json: unknown = await response.json();
    return (this.validateResponses ? endpoint.response.parse(json) : json) as EndpointOutput<E>;
  }

  private url(
    endpoint: Endpoint,
    params?: Record<string, unknown>,
    query?: Record<string, unknown>,
  ): string {
    const path = servedPath(endpoint).replace(/:([A-Za-z]+)/g, (_, name: string) => {
      const value = params?.[name];
      if (value === undefined || value === null || value === '') {
        throw new TypeError(
          `Missing path parameter "${name}" for ${endpoint.method} ${endpoint.path}`,
        );
      }
      return encodeURIComponent(String(value));
    });
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) search.set(key, String(value));
    }
    const qs = search.toString();
    return `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const retryAfter = Number(response.headers.get('retry-after'));
  let problem: ProblemDetails | null = null;
  try {
    const parsed = ProblemDetailsSchema.safeParse(await response.json());
    if (parsed.success) problem = parsed.data;
  } catch {
    // Not JSON (e.g. a proxy error page): keep the status only.
  }
  return new ApiError(
    response.status,
    problem,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  );
}
