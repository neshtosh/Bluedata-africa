import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { AppError } from '../errors/app-error.js';
import { VALKEY } from '../valkey/valkey.module.js';

/**
 * Fixed-window counters in Valkey (ADR-015), shared by all API replicas. Used on abuse-prone
 * endpoints (OTP, password sign-in). If Valkey is unavailable, consume() throws and the request
 * fails — authentication fails closed rather than going unthrottled.
 */
@Injectable()
export class RateLimiter {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async consume(bucket: string, limit: number, windowSeconds: number): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const window = Math.floor(nowSeconds / windowSeconds);
    const key = `rl:${bucket}:${window}`;
    const results = await this.valkey.multi().incr(key).expire(key, windowSeconds).exec();
    const count = Number(results?.[0]?.[1] ?? Number.POSITIVE_INFINITY);
    if (count > limit) {
      const retryAfter = (window + 1) * windowSeconds - nowSeconds;
      throw new AppError({
        status: 429,
        code: 'RATE_LIMITED',
        title: 'Too many requests',
        detail: `Try again in ${retryAfter} seconds.`,
        headers: { 'retry-after': String(retryAfter) },
      });
    }
  }
}

/** Keeps personal data (phone numbers) out of Valkey keys. */
export function bucketKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('base64url').slice(0, 24);
}

@Global()
@Module({ providers: [RateLimiter], exports: [RateLimiter] })
export class RateLimitModule {}
