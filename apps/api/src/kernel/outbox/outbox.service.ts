import { outboxEvents, type Transaction } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../context/request-context.js';

export interface DomainEvent {
  /** `<aggregate>.<past-tense verb>`, e.g. `purchase.confirmed`. Consumers route on this. */
  eventType: string;
  aggregateType: string;
  aggregateId: Id;
  /** IDs and minimal facts only — never whole documents or personal data. */
  payload: Record<string, unknown>;
}

/**
 * Records a domain event in the transactional outbox (ARCHITECTURE.md §13.1). Must be given the
 * transaction of the business change: the event exists if and only if the change committed.
 * The worker's OutboxRelay later moves it onto the queue.
 */
@Injectable()
export class OutboxService {
  async enqueue(tx: Transaction, event: DomainEvent): Promise<Id> {
    const id = newId();
    await tx.insert(outboxEvents).values({
      id,
      organisationId: RequestContext.require().organisationId,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
    });
    return id;
  }
}
