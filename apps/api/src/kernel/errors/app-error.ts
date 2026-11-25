/** One field-level problem inside a problem+json response (API.md §1.1). */
export interface FieldError {
  path: string;
  code: string;
  message: string;
}

export interface AppErrorOptions {
  status: number;
  /** Stable machine-readable code, e.g. INVENTORY_INSUFFICIENT_STOCK. */
  code: string;
  /** Short, human-readable summary that does not change between occurrences. */
  title: string;
  /** Occurrence-specific explanation. Safe to show the client — never include secrets. */
  detail?: string;
  errors?: FieldError[];
  /** Extra response headers, e.g. Retry-After on 429. */
  headers?: Record<string, string>;
  cause?: unknown;
}

/**
 * The only error type domain code should throw for expected failures. The problem-details
 * filter turns it into an RFC 9457 response; anything else becomes a generic 500.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: FieldError[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(options: AppErrorOptions) {
    super(options.detail ?? options.title, { cause: options.cause });
    this.name = 'AppError';
    this.status = options.status;
    this.code = options.code;
    this.title = options.title;
    this.detail = options.detail;
    this.errors = options.errors;
    this.headers = options.headers;
  }

  static validation(errors: FieldError[]): AppError {
    return new AppError({
      status: 400,
      code: 'VALIDATION_FAILED',
      title: 'Request validation failed',
      detail: 'One or more fields are missing or invalid.',
      errors,
    });
  }

  /** Also used for resources in another tenant, so their existence is never revealed. */
  static notFound(detail?: string): AppError {
    return new AppError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Resource not found',
      ...(detail === undefined ? {} : { detail }),
    });
  }
}
