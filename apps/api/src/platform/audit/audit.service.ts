import { auditLog, type DatabaseHandle, type Transaction } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { RequestContext } from '../../kernel/context/request-context.js';
import { DATABASE } from '../../kernel/database/database.token.js';

export interface AuditEntry {
  /** What happened, as `<entity>.<verb>`, e.g. `purchase.confirmed`, `membership.role_assigned`. */
  action: string;
  entityType: string;
  entityId?: Id;
  /**
   * Before/after of the fields that changed. Keep it PII-minimised: IDs and business values,
   * not phone numbers or names — the audit log is retained far longer than ordinary data.
   */
  changes?: Record<string, unknown>;
}

/**
 * Writes to the append-only audit log (ARCHITECTURE.md §14). Always called with the same
 * transaction as the change it records, so a change and its audit entry commit together —
 * there is no "changed but not audited" state. Actor, tenant, request ID and IP come from the
 * request context, so callers cannot misattribute an entry.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  /**
   * For identity events with no surrounding business transaction (sign-in, logout, password
   * change). Tenant-scoped changes must use record(tx, …) inside their own transaction.
   */
  recordStandalone(entry: AuditEntry): Promise<void> {
    return this.database.db.transaction((tx) => this.record(tx, entry));
  }

  async record(tx: Transaction, entry: AuditEntry): Promise<void> {
    const context = RequestContext.require();
    await tx.insert(auditLog).values({
      id: newId(),
      organisationId: context.organisationId,
      actorUserId: context.userId,
      actorType: context.userId ? 'user' : 'system',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      changes: entry.changes ?? null,
      requestId: context.requestId,
      ip: context.ip,
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
