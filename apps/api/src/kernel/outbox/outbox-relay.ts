import { outboxEvents, type DatabaseHandle } from '@blue/database';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { inArray, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE } from '../database/database.token.js';
import { DOMAIN_EVENTS_QUEUE } from '../queue/queue.module.js';

export interface DomainEventJob {
  eventId: string;
  organisationId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: string;
}

type BatchOutcome =
  { kind: 'published'; count: number } | { kind: 'failed'; ids: string[]; error: unknown };

interface OutboxRow extends Record<string, unknown> {
  id: string;
  organisation_id: string | null;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  occurred_at: Date;
}

/**
 * Moves committed outbox events onto the `domain-events` queue. Delivery is at-least-once:
 * the BullMQ job ID is the event ID, so an event relayed twice (e.g. if marking it published
 * failed) is de-duplicated while the job is retained, and consumers must still be idempotent
 * on `eventId`. FOR UPDATE SKIP LOCKED lets several worker replicas relay without overlap.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(DOMAIN_EVENTS_QUEUE) private readonly queue: Queue<DomainEventJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Relays one batch. Returns how many events were published. */
  async relayBatch(): Promise<number> {
    const outcome = await this.database.db.transaction(async (tx): Promise<BatchOutcome> => {
      const { rows } = await tx.execute<OutboxRow>(sql`
        select id, organisation_id, event_type, aggregate_type, aggregate_id, payload, occurred_at
        from system.outbox_events
        where published_at is null
        order by occurred_at
        limit ${this.config.OUTBOX_BATCH_SIZE}
        for update skip locked
      `);
      if (rows.length === 0) return { kind: 'published', count: 0 };

      const ids = rows.map((row) => row.id);
      try {
        await this.queue.addBulk(
          rows.map((row) => ({
            name: row.event_type,
            data: {
              eventId: row.id,
              organisationId: row.organisation_id,
              eventType: row.event_type,
              aggregateType: row.aggregate_type,
              aggregateId: row.aggregate_id,
              payload: row.payload,
              occurredAt: new Date(row.occurred_at).toISOString(),
            },
            opts: { jobId: row.id, removeOnComplete: { count: 10_000 }, removeOnFail: false },
          })),
        );
      } catch (error) {
        return { kind: 'failed', ids, error };
      }
      await tx
        .update(outboxEvents)
        .set({ publishedAt: new Date(), attempts: sql`${outboxEvents.attempts} + 1` })
        .where(inArray(outboxEvents.id, ids));
      return { kind: 'published', count: rows.length };
    });

    if (outcome.kind === 'failed') {
      // The locks were released with the transaction; record the failed attempt separately so
      // the events are retried on the next poll and stuck ones are visible in the table.
      const message =
        outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      this.logger.warn(`Outbox relay failed for ${outcome.ids.length} events: ${message}`);
      await this.database.db
        .update(outboxEvents)
        .set({ attempts: sql`${outboxEvents.attempts} + 1`, lastError: message.slice(0, 1000) })
        .where(inArray(outboxEvents.id, outcome.ids));
      return 0;
    }
    return outcome.count;
  }
}
