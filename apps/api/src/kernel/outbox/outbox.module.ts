import { Global, Module } from '@nestjs/common';
import { OutboxRelay } from './outbox-relay.js';
import { OutboxService } from './outbox.service.js';

/** OutboxService (write side) is available in both processes; OutboxRelay runs in the worker. */
@Global()
@Module({
  providers: [OutboxService, OutboxRelay],
  exports: [OutboxService, OutboxRelay],
})
export class OutboxModule {}
