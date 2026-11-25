import type { DatabaseHandle } from '@blue/database';
import { endpoints } from '@blue/contracts';
import { Controller, Inject, Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { DATABASE } from '../../kernel/database/database.token.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { Public } from '../access/access-policy.js';
import { VALKEY } from '../../kernel/valkey/valkey.module.js';

const CHECK_TIMEOUT_MS = 2000;

type CheckResult = 'ok' | 'failed';

/**
 * Liveness: the process is up (restart it if this fails).
 * Readiness: it can serve traffic — database and Valkey reachable (stop routing to it if not).
 * Both are unauthenticated and unversioned (excluded from the /v1 prefix) for load balancers.
 */
@Controller()
@Public()
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(VALKEY) private readonly valkey: Redis,
  ) {}

  @Endpoint(endpoints.health.live)
  live() {
    return { status: 'ok' };
  }

  @Endpoint(endpoints.health.ready)
  async ready() {
    const [database, valkey] = await Promise.all([
      runCheck(() => this.database.db.execute(sql`select 1`)),
      runCheck(() => this.valkey.ping()),
    ]);
    const checks = { database, valkey };
    const failed = Object.entries(checks)
      .filter(([, result]) => result === 'failed')
      .map(([name]) => name);
    if (failed.length > 0) {
      throw new AppError({
        status: 503,
        code: 'NOT_READY',
        title: 'Service not ready',
        detail: `Unavailable dependencies: ${failed.join(', ')}`,
      });
    }
    return { status: 'ok', checks };
  }
}

async function runCheck(check: () => Promise<unknown>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('health check timed out')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'ok';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
