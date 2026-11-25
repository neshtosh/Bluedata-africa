import {
  memberships,
  organisations,
  users,
  withTenantContext,
  type Database,
} from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import {
  RequestContext,
  type RequestContextStore,
} from '../../src/kernel/context/request-context.js';

export interface TenantFixture {
  organisationId: Id;
  userId: Id;
  branchId: Id;
}

/** Creates a user with an active membership of a new organisation, as the runtime role. */
export async function createTenant(
  db: Database,
  slug: string,
  phone: string,
): Promise<TenantFixture> {
  const tenant: TenantFixture = { organisationId: newId(), userId: newId(), branchId: newId() };
  await db.insert(users).values({ id: tenant.userId, displayName: slug, phoneE164: phone });
  await withTenantContext(db, tenant, async (tx) => {
    await tx.insert(organisations).values({
      id: tenant.organisationId,
      legalName: `${slug} Ltd`,
      slug,
      countryCode: 'KE',
      defaultCurrency: 'KES',
      timezone: 'Africa/Nairobi',
    });
    await tx.insert(memberships).values({
      organisationId: tenant.organisationId,
      userId: tenant.userId,
      status: 'active',
    });
  });
  return tenant;
}

/** Runs `fn` as if inside an authenticated request for this tenant (what 2.4's guards will set). */
export function asTenantRequest<T>(tenant: TenantFixture, fn: () => T): T {
  const store: RequestContextStore = {
    ...RequestContext.create(newId(), '203.0.113.10'),
    userId: tenant.userId,
    organisationId: tenant.organisationId,
  };
  return RequestContext.run(store, fn);
}
