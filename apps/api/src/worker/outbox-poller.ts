import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../kernel/config/app-config.js';
import { OutboxRelay } from '../kernel/outbox/outbox-relay.js';

/**
 * Polls the outbox in the worker process. Batches run back-to-back while there is a backlog,
 * then wait OUTBOX_POLL_INTERVAL_MS. Runs never overlap, and shutdown waits for the current
 * batch so no transaction is cut off.
 */
@Injectable()
export class OutboxPoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPoller.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = false;

  constructor(
    @Inject(OutboxRelay) private readonly relay: OutboxRelay,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    let published = 0;
    try {
      published = await this.relay.relayBatch();
    } catch (error) {
      this.logger.error({ err: error }, 'Outbox relay batch failed');
    }
    // A full batch suggests a backlog: continue immediately.
    this.schedule(
      published >= this.config.OUTBOX_BATCH_SIZE ? 0 : this.config.OUTBOX_POLL_INTERVAL_MS,
    );
  }
}
