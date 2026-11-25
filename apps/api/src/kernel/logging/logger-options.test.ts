import { pino } from 'pino';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS } from './logger-options.js';

function captureLog(entry: Record<string, unknown>): string {
  let output = '';
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  pino({ redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } }, sink).info(entry, 'test');
  return output;
}

describe('log redaction', () => {
  it('removes personal data and credentials at the top level and one level down', () => {
    const line = captureLog({
      phoneE164: '+254700000001',
      email: 'trader@example.com',
      user: { phone: '+256700000002', password: 'hunter2', otpCode: '123456' },
      session: { token: 'abc.def.ghi' },
      req: { headers: { authorization: 'Bearer live-key', cookie: 'session=xyz' } },
    });
    for (const secret of [
      '+254700000001',
      'trader@example.com',
      '+256700000002',
      'hunter2',
      '123456',
      'abc.def.ghi',
      'live-key',
      'session=xyz',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[REDACTED]');
  });

  it('keeps error codes, which are needed for debugging', () => {
    const line = captureLog({ err: { code: '23503', message: 'foreign key violation' } });
    expect(line).toContain('23503');
  });
});
