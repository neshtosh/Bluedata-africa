import { idempotencyKeys, type Transaction } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { RequestContext } from '../context/request-context.js';
import { pgError, UNIQUE_VIOLATION } from '../database/pg-error.js';
import { TenantDatabase } from '../database/tenant-database.js';
import { AppError } from '../errors/app-error.js';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // long enough for offline devices to resync
/** A reservation with no stored response after this long is treated as an abandoned request. */
const ABANDONED_AFTER_MS = 60 * 1000;

export type Reservation =
  { kind: 'new'; id: Id } | { kind: 'replay'; status: number; body: unknown };

/**
 * Idempotency-Key bookkeeping (API.md §1). Keys are scoped to (organisation, user), or to the
 * user alone for non-tenant routes; RLS on system.idempotency_keys enforces the same scope.
 */
@Injectable()
export class IdempotencyStore {
  constructor(@Inject(TenantDatabase) private readonly tenantDb: TenantDatabase) {}

  reserve(key: string, requestHash: Buffer): Promise<Reservation> {
    return this.inScope(async (tx, organisationId, userId) => {
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            organisationId
              ? eq(idempotencyKeys.organisationId, organisationId)
              : isNull(idempotencyKeys.organisationId),
            eq(idempotencyKeys.userId, userId),
            eq(idempotencyKeys.key, key),
          ),
        );
      if (existing) {
        if (!existing.requestHash.equals(requestHash)) {
          throw new AppError({
            status: 409,
            code: 'IDEMPOTENCY_KEY_REUSED',
            title: 'Idempotency key reused with a different request',
            detail: 'Use a new Idempotency-Key for a different request.',
          });
        }
        if (existing.responseStatus !== null) {
          return { kind: 'replay', status: existing.responseStatus, body: existing.responseBody };
        }
        if (Date.now() - existing.createdAt.getTime() < ABANDONED_AFTER_MS) throw inProgress();
        await tx.delete(idempotencyKeys).where(eq(idempotencyKeys.id, existing.id));
      }
      const id = newId();
      try {
        await tx.insert(idempotencyKeys).values({
          id,
          organisationId,
          userId,
          key,
          requestHash,
          expiresAt: new Date(Date.now() + RETENTION_MS),
        });
      } catch (error) {
        // A concurrent request with the same key reserved it first.
        if (pgError(error).code === UNIQUE_VIOLATION) throw inProgress();
        throw error;
      }
      return { kind: 'new', id };
    });
  }

  async complete(id: Id, status: number, body: unknown): Promise<void> {
    await this.inScope((tx) =>
      tx
        .update(idempotencyKeys)
        .set({ responseStatus: status, responseBody: body ?? null })
        .where(eq(idempotencyKeys.id, id)),
    );
  }

  /** The request failed: release the key so the client can retry with it. */
  async release(id: Id): Promise<void> {
    await this.inScope((tx) => tx.delete(idempotencyKeys).where(eq(idempotencyKeys.id, id)));
  }

  private inScope<T>(
    work: (tx: Transaction, organisationId: Id | null, userId: Id) => Promise<T>,
  ): Promise<T> {
    const { organisationId, userId } = RequestContext.require();
    if (!userId) return Promise.reject(new Error('idempotency requires a signed-in user'));
    return organisationId
      ? this.tenantDb.inTenant((tx) => work(tx, organisationId, userId))
      : this.tenantDb.asUser((tx) => work(tx, null, userId));
  }
}

function inProgress(): AppError {
  return new AppError({
    status: 409,
    code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    title: 'A request with this Idempotency-Key is still being processed',
    headers: { 'retry-after': '2' },
  });
}
