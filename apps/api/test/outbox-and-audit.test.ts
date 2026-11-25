// The "one use case, one transaction" contract: business change + audit entry + outbox event
// commit or roll back together, and the worker relays committed events to the queue.
import { auditLog, branches, outboxEvents, type Database } from '@blue/database';
import { newId } from '@blue/primitives';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createWorker } from '../src/create-worker.js';
import { TenantDatabase } from '../src/kernel/database/tenant-database.js';
import { OutboxRelay, type DomainEventJob } from '../src/kernel/outbox/outbox-relay.js';
import { OutboxService } from '../src/kernel/outbox/outbox.service.js';
import { DOMAIN_EVENTS_QUEUE_NAME } from '../src/kernel/queue/queue.module.js';
import { AuditService } from '../src/platform/audit/audit.service.js';
import { asTenantRequest, createTenant, type TenantFixture } from './helpers/tenant-fixture.js';
import {
  startApp,
  startTestEnvironment,
  type TestEnvironment,
} from './helpers/test-environment.js';

let env: TestEnvironment;
let app: NestFastifyApplication;
let db: Database;
let tenant: TenantFixture;
let tenantDb: TenantDatabase;
let audit: AuditService;
let outbox: OutboxService;
let relay: OutboxRelay;
let inspector: { connection: Redis; queue: Queue<DomainEventJob> };

/** A representative use case: create a branch, audit it, emit an event — in one transaction. */
function createBranch(name: string, failAfterWrites = false) {
  return asTenantRequest(tenant, () =>
    tenantDb.inTenant(async (tx) => {
      const id = newId();
      await tx.insert(branches).values({ id, organisationId: tenant.organisationId, name });
      await audit.record(tx, { action: 'branch.created', entityType: 'branch', entityId: id });
      await outbox.enqueue(tx, {
        eventType: 'branch.created',
        aggregateType: 'branch',
        aggregateId: id,
        payload: { branchId: id },
      });
      if (failAfterWrites) throw new Error('simulated failure after all writes');
      return id;
    }),
  );
}

function outboxRowsFor(branchId: string) {
  return db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, branchId));
}

beforeAll(async () => {
  env = await startTestEnvironment();
  app = await startApp(env.config);
  db = env.database.runtime.db;
  tenant = await createTenant(db, 'mwanza-processors', '+255700000003');
  tenantDb = app.get(TenantDatabase);
  audit = app.get(AuditService);
  outbox = app.get(OutboxService);
  relay = app.get(OutboxRelay);
  const connection = new Redis(env.config.VALKEY_URL, { maxRetriesPerRequest: null });
  inspector = { connection, queue: new Queue(DOMAIN_EVENTS_QUEUE_NAME, { connection }) };
});

afterAll(async () => {
  await inspector?.queue.close();
  await inspector?.connection.quit();
  await app?.close();
  await env?.stop();
});

describe('transactional writes', () => {
  it('records the audit entry with actor, tenant, request ID and IP from the request context', async () => {
    const branchId = await createBranch('Mwanza cold store');
    const [entry] = await asTenantRequest(tenant, () =>
      tenantDb.inTenant((tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, branchId))),
    );
    expect(entry).toMatchObject({
      organisationId: tenant.organisationId,
      actorUserId: tenant.userId,
      actorType: 'user',
      action: 'branch.created',
      ip: '203.0.113.10',
    });
    expect(entry?.requestId).toBeTruthy();
  });

  it('rolls back the change, its audit entry and its event together on failure', async () => {
    const before = await db.select().from(outboxEvents);
    await expect(createBranch('Never created', true)).rejects.toThrow('simulated failure');
    const after = await db.select().from(outboxEvents);
    expect(after).toHaveLength(before.length);
    const branchRows = await asTenantRequest(tenant, () =>
      tenantDb.inTenant((tx) =>
        tx.select().from(branches).where(eq(branches.name, 'Never created')),
      ),
    );
    expect(branchRows).toEqual([]);
  });
});

describe('outbox relay', () => {
  it('publishes committed events to the queue exactly once and marks them published', async () => {
    const branchId = await createBranch('Jinja landing office');
    const [event] = await outboxRowsFor(branchId);
    if (!event) throw new Error('expected an outbox event for the new branch');
    expect(event.publishedAt).toBeNull();

    expect(await relay.relayBatch()).toBeGreaterThanOrEqual(1);
    const [published] = await outboxRowsFor(branchId);
    expect(published?.publishedAt).not.toBeNull();

    const job = await inspector.queue.getJob(event.id);
    expect(job?.name).toBe('branch.created');
    expect(job?.data).toMatchObject({
      eventId: event.id,
      organisationId: tenant.organisationId,
      aggregateId: branchId,
      payload: { branchId },
    });

    expect(await relay.relayBatch()).toBe(0); // nothing left to relay
  });

  it('keeps events unpublished and records the error when the queue is unavailable', async () => {
    const branchId = await createBranch('Kisumu depot');
    const queue = (relay as unknown as { queue: Queue }).queue;
    const spy = vi.spyOn(queue, 'addBulk').mockRejectedValueOnce(new Error('Valkey unavailable'));
    try {
      expect(await relay.relayBatch()).toBe(0);
    } finally {
      spy.mockRestore();
    }
    const [failed] = await outboxRowsFor(branchId);
    expect(failed).toMatchObject({
      publishedAt: null,
      attempts: 1,
      lastError: 'Valkey unavailable',
    });

    expect(await relay.relayBatch()).toBeGreaterThanOrEqual(1); // retried on the next poll
    const [retried] = await outboxRowsFor(branchId);
    expect(retried?.publishedAt).not.toBeNull();
  });
});

describe('worker process', () => {
  it('boots from its own entrypoint module and relays events without being asked', async () => {
    let worker: INestApplicationContext | undefined;
    try {
      worker = await createWorker(env.config);
      await worker.init();
      const branchId = await createBranch('Bukoba office');
      await vi.waitFor(
        async () => {
          const [row] = await outboxRowsFor(branchId);
          expect(row?.publishedAt).not.toBeNull();
        },
        { timeout: 10_000, interval: 200 },
      );
    } finally {
      await worker?.close();
    }
  });
});
