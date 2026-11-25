// Security primitives for identity (ADR-007), built only on node:crypto. Keep this file small and
// boring: every function here is security-critical and covered by crypto.test.ts.
import {
  argon2,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/** OWASP Password Storage Cheat Sheet, Argon2id option 1: m=19 MiB, t=2, p=1. */
const ARGON2_PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

/**
 * Hashes a password with Argon2id. Returns a self-describing PHC string
 * ($argon2id$v=19$m=…,t=…,p=…$salt$hash) so parameters can be raised later without breaking
 * existing hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await argon2Async('argon2id', { ...ARGON2_PARAMS, message: password, nonce: salt });
  const { memory: m, passes: t, parallelism: p } = ARGON2_PARAMS;
  return `$argon2id$v=19$m=${m},t=${t},p=${p}$${b64(salt)}$${b64(hash)}`;
}

/** Constant-time check of a password against a PHC string. False for malformed hashes. */
export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  const match =
    /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(phc);
  if (!match) return false;
  const [, m, t, p, saltB64, hashB64] = match;
  const expected = Buffer.from(hashB64 ?? '', 'base64');
  const actual = await argon2Async('argon2id', {
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: expected.length,
    message: password,
    nonce: Buffer.from(saltB64 ?? '', 'base64'),
  });
  return safeEqual(actual, expected);
}

/** A hash to verify against when the account does not exist, so timing doesn't reveal that. */
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString('hex'));

/** Uniformly random numeric one-time code (randomInt avoids modulo bias). */
export function generateOtp(length: number): string {
  return randomInt(0, 10 ** length)
    .toString()
    .padStart(length, '0');
}

/** HMAC-SHA256 under the server secret, so a database leak alone can't brute-force codes. */
export function hmac(secret: string, ...parts: string[]): Buffer {
  return createHmac('sha256', secret).update(parts.join('\u0000')).digest();
}

/** 256-bit random session token (sent to the client) and its SHA-256 (stored). */
export function newSessionToken(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

function b64(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '');
}
