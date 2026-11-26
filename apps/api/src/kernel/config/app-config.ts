import { z } from 'zod';

/**
 * Every environment variable the backend reads, validated once at startup. A missing or
 * malformed value stops the process with a list of problems, instead of failing later at the
 * first request that needs it. Secrets come from the environment only (ARCHITECTURE.md §14).
 */
const envSchema = z.object({
  /** `staging` behaves like production except that the development SMS channel is allowed. */
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** app_runtime connection — subject to RLS. Never the migrator or a superuser. */
  DATABASE_RUNTIME_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  VALKEY_URL: z.url({ protocol: /^rediss?$/ }),
  /** Outbox relay: how often to poll, and how many events to move per batch. */
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),

  // --- Authentication (ADR-007) ---
  /** Server-side key for HMACs of OTP codes and destinations. Rotate = invalidate open OTPs. */
  AUTH_SECRET: z.string().min(32, 'must be at least 32 characters of random data'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  /**
   * `log` writes codes to the server log and exists for development and tests only. `none` turns
   * SMS sign-in off: people sign in with a password set through a setup link (ADR-019).
   */
  SMS_PROVIDER: z.enum(['log', 'none']).default('log'),
  /** How long a one-time setup link works. */
  SETUP_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(336).default(72),
  /** Parent domain shared by samakios./bluedata. subdomains, e.g. `.example.africa`. */
  COOKIE_DOMAIN: z.string().min(1).optional(),
  /** Defaults to true everywhere except development and test (plain-http localhost). */
  COOKIE_SECURE: z.stringbool().optional(),

  // --- HTTP edge ---
  /** Comma-separated browser origins allowed to call the API with credentials. */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url({ protocol: /^https?$/ }))),
  /** Set when running behind a trusted load balancer, so client IPs come from X-Forwarded-For. */
  TRUST_PROXY: z.stringbool().default(false),
});

/**
 * Rules that span several variables. Deployed environments (staging, production) never send
 * session cookies over plain HTTP. Production also never logs sign-in codes; staging may, until a
 * real SMS provider exists — so staging must only ever hold synthetic data.
 */
const configSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production' && env.NODE_ENV !== 'staging') return;
  if (env.NODE_ENV === 'production' && env.SMS_PROVIDER === 'log') {
    ctx.addIssue({
      code: 'custom',
      path: ['SMS_PROVIDER'],
      message: 'the log provider is not allowed in production; configure a real SMS provider',
    });
  }
  if (env.COOKIE_SECURE === false) {
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECURE'],
      message: 'session cookies must be Secure in production',
    });
  }
});

export type AppConfig = Readonly<z.infer<typeof envSchema>> & { readonly COOKIE_SECURE: boolean };

export const APP_CONFIG = Symbol('APP_CONFIG');

export class ConfigValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    // Report variable names and reasons only — never echo values, which may be secrets.
    throw new ConfigValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  const data = result.data;
  return Object.freeze({
    ...data,
    COOKIE_SECURE: data.COOKIE_SECURE ?? !['development', 'test'].includes(data.NODE_ENV),
  });
}
