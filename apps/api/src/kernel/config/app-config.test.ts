import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadConfig } from './app-config.js';

const valid = {
  DATABASE_RUNTIME_URL: 'postgres://app_runtime:secret-pw@localhost:5432/blue',
  VALKEY_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
};

describe('loadConfig', () => {
  it('applies defaults and coerces numbers', () => {
    const config = loadConfig({ ...valid, PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('development');
    expect(config.DATABASE_POOL_SIZE).toBe(10);
  });

  it('lists every invalid variable at once', () => {
    let error: unknown;
    try {
      loadConfig({ PORT: 'not-a-port', VALKEY_URL: 'http://wrong-scheme' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigValidationError);
    const message = (error as ConfigValidationError).message;
    expect(message).toContain('DATABASE_RUNTIME_URL');
    expect(message).toContain('VALKEY_URL');
    expect(message).toContain('PORT');
  });

  it('never echoes values, which may be secrets', () => {
    let message = '';
    try {
      loadConfig({ ...valid, DATABASE_RUNTIME_URL: 'mysql://user:secret-pw@host/db' });
    } catch (caught) {
      message = (caught as Error).message;
    }
    expect(message).toContain('DATABASE_RUNTIME_URL');
    expect(message).not.toContain('secret-pw');
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig(valid))).toBe(true);
  });

  it('refuses development-only shortcuts in production', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(/SMS_PROVIDER/);
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it('lets staging use the development SMS channel but still requires Secure cookies', () => {
    const staging = loadConfig({ ...valid, NODE_ENV: 'staging' });
    expect(staging.SMS_PROVIDER).toBe('log');
    expect(staging.COOKIE_SECURE).toBe(true);
    expect(() => loadConfig({ ...valid, NODE_ENV: 'staging', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it('defaults cookies to Secure except in development and test', () => {
    expect(loadConfig({ ...valid, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false);
    expect(loadConfig({ ...valid, NODE_ENV: 'test' }).COOKIE_SECURE).toBe(false);
  });

  it('requires a long AUTH_SECRET', () => {
    expect(() => loadConfig({ ...valid, AUTH_SECRET: 'short' })).toThrow(/AUTH_SECRET/);
  });

  it('parses CORS origins and rejects malformed ones', () => {
    expect(
      loadConfig({ ...valid, CORS_ORIGINS: 'http://localhost:3000, https://app.example.africa' })
        .CORS_ORIGINS,
    ).toEqual(['http://localhost:3000', 'https://app.example.africa']);
    expect(() => loadConfig({ ...valid, CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
  });
});
