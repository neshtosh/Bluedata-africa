import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config.js';

/**
 * Field names removed from every log line (ARCHITECTURE.md §14 — PII redaction). Phones,
 * emails, credentials and tokens must never reach log storage. Extend this list whenever a new
 * sensitive field is introduced. Not 'code': that would also hide SQLSTATE / Node error codes.
 */
export const SENSITIVE_KEYS = [
  'password',
  'passwordHash',
  'secret',
  'token',
  'otp',
  'otpCode',
  'phone',
  'phoneE164',
  'email',
  'apiKey',
] as const;

// pino wildcards match exactly one level, so each key is redacted at the top level and one
// level down. Don't log deeper structures that contain personal data — log IDs instead.
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
];

export function buildLoggerParams(config: AppConfig): Params {
  return {
    pinoHttp: {
      level: config.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
      // Fastify assigns the request ID (see main.api.ts); reuse it so logs and responses match.
      genReqId: (req) => req.id,
      customProps: () => ({ service: 'api' }),
      // Health probes run every few seconds; logging them would drown real traffic.
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      serializers: {
        // Log the route, never the query string (it can carry identifiers).
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
        }),
      },
    },
  };
}
