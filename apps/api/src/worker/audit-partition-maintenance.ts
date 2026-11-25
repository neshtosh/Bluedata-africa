import type { DatabaseHandle } from '@blue/database';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../kernel/database/database.token.js';

const MONTHS_AHEAD = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps audit.audit_log partitions created a few months ahead (DATABASE.md §6), on worker start
 * and daily. The SQL function is idempotent, so several worker replicas running it is harmless.
 * Moves to a BullMQ job scheduler once the worker has other scheduled jobs.
 */
@Injectable()
export class AuditPartitionMaintenance implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AuditPartitionMaintenance.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.run();
    this.timer = setInterval(() => void this.run(), DAY_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      await this.database.db.execute(sql`select app.ensure_audit_partitions(${MONTHS_AHEAD})`);
    } catch (error) {
      this.logger.error({ err: error }, 'Audit partition maintenance failed');
    }
  }
}
