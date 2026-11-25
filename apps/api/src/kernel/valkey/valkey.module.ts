import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/** Shared Valkey/Redis connection (ADR-015): queues, rate limits, short-lived caches only. */
export const VALKEY = Symbol('VALKEY');

@Injectable()
class ValkeyShutdown implements OnApplicationShutdown {
  constructor(@Inject(VALKEY) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // quit() waits in the offline queue if the server is unreachable, which would hang
    // shutdown; drop the connection instead when we are not connected.
    if (this.client.status === 'ready') await this.client.quit();
    else this.client.disconnect();
  }
}

function createValkeyClient(config: AppConfig): Redis {
  const logger = new Logger('Valkey');
  // maxRetriesPerRequest: null is required by BullMQ for blocking commands.
  const client = new Redis(config.VALKEY_URL, { maxRetriesPerRequest: null });
  // Without a listener ioredis reports every reconnect failure as an unhandled error event.
  client.on('error', (error: Error) => logger.warn(`Valkey connection error: ${error.message}`));
  return client;
}

@Global()
@Module({
  providers: [
    { provide: VALKEY, inject: [APP_CONFIG], useFactory: createValkeyClient },
    ValkeyShutdown,
  ],
  exports: [VALKEY],
})
export class ValkeyModule {}
