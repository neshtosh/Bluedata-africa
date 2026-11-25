import { describe, expect, it } from 'vitest';
import {
  generateOtp,
  hashPassword,
  hashSessionToken,
  hmac,
  newSessionToken,
  verifyPassword,
} from './crypto.js';

describe('password hashing', () => {
  it('produces a salted Argon2id PHC string that verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse batterz')).toBe(false);
  });

  it('salts every hash differently', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });

  it('rejects malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(await verifyPassword('$argon2i$v=19$m=1,t=1,p=1$AAAA$AAAA', 'x')).toBe(false);
  });
});

describe('one-time codes', () => {
  it('are fixed-length digit strings, including leading zeros', () => {
    for (let i = 0; i < 500; i++) expect(generateOtp(6)).toMatch(/^[0-9]{6}$/);
  });
});

describe('hmac', () => {
  it('depends on the secret and separates parts unambiguously', () => {
    expect(hmac('secret-a', 'x')).not.toEqual(hmac('secret-b', 'x'));
    expect(hmac('s', 'ab', 'c')).not.toEqual(hmac('s', 'a', 'bc'));
  });
});

describe('session tokens', () => {
  it('are 256-bit, URL-safe, unique, and stored only as their hash', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toEqual(hashSessionToken(a.token));
    expect(a.tokenHash.toString('utf8')).not.toContain(a.token);
  });
});
