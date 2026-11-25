import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../kernel/config/app-config.js';

export const SESSION_COOKIE = 'blue_session';

/**
 * HttpOnly (no JavaScript access), SameSite=Lax (not sent on cross-site POSTs), Secure outside
 * local development, and scoped to the parent domain when COOKIE_DOMAIN is set so one sign-in
 * covers both product subdomains (ADR-003, ADR-007).
 */
export function setSessionCookie(
  reply: FastifyReply,
  config: AppConfig,
  token: string,
  expiresAt: Date,
): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  void reply.header('set-cookie', serialize(config, token, maxAge, expiresAt));
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  void reply.header('set-cookie', serialize(config, '', 0, new Date(0)));
}

/** Reads the session token from the Cookie header. Tokens are base64url, so no decoding is needed. */
export function readSessionCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null;
  }
  return null;
}

function serialize(config: AppConfig, value: string, maxAge: number, expires: Date): string {
  const attributes = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    `Expires=${expires.toUTCString()}`,
  ];
  if (config.COOKIE_SECURE) attributes.push('Secure');
  if (config.COOKIE_DOMAIN) attributes.push(`Domain=${config.COOKIE_DOMAIN}`);
  return attributes.join('; ');
}
