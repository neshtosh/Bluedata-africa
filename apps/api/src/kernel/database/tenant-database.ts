import {
  withTenantContext,
  withUserContext,
  type DatabaseHandle,
  type Transaction,
} from '@blue/database';
import { Inject, Injectable } from '@nestjs/common';
import { RequestContext } from '../context/request-context.js';
import { DATABASE } from './database.token.js';

/**
 * The way module code touches tenant data: each call opens one transaction scoped to the
 * current request's organisation (and user), so RLS applies (ARCHITECTURE.md §9.2). Put a whole
 * use case — document, stock, audit entry and outbox event — inside a single call so it commits
 * or rolls back together.
 */
@Injectable()
export class TenantDatabase {
  constructor(@Inject(DATABASE) private readonly handle: DatabaseHandle) {}

  inTenant<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const { organisationId, userId } = RequestContext.require();
    if (!organisationId) {
      // Reaching this means a route touched tenant data without the tenant guard — a bug,
      // not a client error, so it surfaces as a 500 and is logged.
      return Promise.reject(new Error('inTenant() called without an organisation in context'));
    }
    return withTenantContext(this.handle.db, { organisationId, userId }, work);
  }

  /** For signed-in work before an organisation is chosen (list my organisations, register one). */
  asUser<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const { userId } = RequestContext.require();
    if (!userId) return Promise.reject(new Error('asUser() called without a user in context'));
    return withUserContext(this.handle.db, userId, work);
  }
}
