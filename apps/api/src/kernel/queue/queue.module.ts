import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { VALKEY } from '../valkey/valkey.module.js';

/** Queue carrying domain events from the outbox to consumers (ARCHITECTURE.md §13.1). */
export const DOMAIN_EVENTS_QUEUE = Symbol('DOMAIN_EVENTS_QUEUE');
export const DOMAIN_EVENTS_QUEUE_NAME = 'domain-events';

@Injectable()
class QueueShutdown implements OnApplicationShutdown {
  constructor(@Inject(DOMAIN_EVENTS_QUEUE) private readonly queue: Queue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DOMAIN_EVENTS_QUEUE,
      inject: [VALKEY],
      // Producers can share the app's connection; consumers (BullMQ Workers) get their own.
      useFactory: (connection: Redis) => new Queue(DOMAIN_EVENTS_QUEUE_NAME, { connection }),
    },
    QueueShutdown,
  ],
  exports: [DOMAIN_EVENTS_QUEUE],
})
export class QueueModule {}
