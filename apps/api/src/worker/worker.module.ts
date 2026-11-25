import { Module, type DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../kernel/config/app-config.js';
import { ConfigModule } from '../kernel/config/config.module.js';
import { DatabaseModule } from '../kernel/database/database.module.js';
import { buildLoggerParams } from '../kernel/logging/logger-options.js';
import { OutboxModule } from '../kernel/outbox/outbox.module.js';
import { QueueModule } from '../kernel/queue/queue.module.js';
import { ValkeyModule } from '../kernel/valkey/valkey.module.js';
import { AuditPartitionMaintenance } from './audit-partition-maintenance.js';
import { OutboxPoller } from './outbox-poller.js';

/**
 * Root of the worker process (ADR-001): same codebase and modules as the API, no HTTP server.
 * Runs background work — outbox relay now; imports, aggregation and notifications later.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot(buildLoggerParams(config)),
        DatabaseModule,
        ValkeyModule,
        QueueModule,
        OutboxModule,
      ],
      providers: [OutboxPoller, AuditPartitionMaintenance],
    };
  }
}
