// Proves the multi-tenancy guarantees in ARCHITECTURE.md §9 against a real PostGIS database,
// connected as app_runtime exactly like the API. Any regression here is a data-leak bug.
import { newId, type Id } from '@blue/primitives';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/client.js';
import {
  auditLog,
  branches,
  currencies,
  membershipRoles,
  memberships,
  organisations,
  roles,
  subscriptions,
  users,
} from '../src/schema/index.js';
import { withTenantContext, withUserContext } from '../src/tenant-context.js';
import {
  expectPgError,
  SQLSTATE,
  startTestDatabase,
  type TestDatabase,
} from '../src/testing/index.js';

interface Tenant {
  organisationId: Id;
  userId: Id;
  membershipId: Id;
  roleId: Id;
  branchId: Id;
}

let testDb: TestDatabase;
let db: Database;
let tenantA: Tenant;
let tenantB: Tenant;

async function createTenant(slug: string, phone: string): Promise<Tenant> {
  const tenant: Tenant = {
    organisationId: newId(),
    userId: newId(),
    membershipId: newId(),
    roleId: newId(),
    branchId: newId(),
  };
  // Identity tables are global (not tenant-scoped), written by the identity module.
  await db.insert(users).values({ id: tenant.userId, displayName: slug, phoneE164: phone });

  // Registration flow: the new organisation's ID is the tenant context from the first insert.
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
      id: tenant.membershipId,
      organisationId: tenant.organisationId,
      userId: tenant.userId,
      status: 'active',
    });
    await tx.insert(roles).values({
      id: tenant.roleId,
      organisationId: tenant.organisationId,
      key: 'owner',
      name: 'Owner',
      isSystem: true,
    });
    await tx.insert(branches).values({
      id: tenant.branchId,
      organisationId: tenant.organisationId,
      name: `${slug} head office`,
    });
  });
  return tenant;
}

beforeAll(async () => {
  testDb = await startTestDatabase();
  db = testDb.runtime.db;
  tenantA = await createTenant('kisumu-traders', '+254700000001');
  tenantB = await createTenant('jinja-fish-co', '+256700000002');
});

afterAll(async () => {
  await testDb?.stop();
});

describe('reading', () => {
  it('a tenant sees only its own rows', async () => {
    const rows = await withTenantContext(db, tenantA, (tx) => tx.select().from(branches));
    expect(rows.map((r) => r.id)).toEqual([tenantA.branchId]);
  });

  it('a tenant cannot fetch another tenant’s row even by exact ID', async () => {
    const rows = await withTenantContext(db, tenantA, (tx) =>
      tx.select().from(branches).where(eq(branches.id, tenantB.branchId)),
    );
    expect(rows).toEqual([]);
  });

  it('without a tenant context, tenant tables are empty (fail closed)', async () => {
    for (const table of [organisations, branches, memberships, roles]) {
      expect(await db.select().from(table)).toEqual([]);
    }
  });

  it('a user with no organisation selected sees only their own memberships and organisations', async () => {
    const result = await withUserContext(db, tenantA.userId, async (tx) => ({
      memberships: await tx.select().from(memberships),
      organisations: await tx.select().from(organisations),
      branches: await tx.select().from(branches),
    }));
    expect(result.memberships.map((m) => m.organisationId)).toEqual([tenantA.organisationId]);
    expect(result.organisations.map((o) => o.id)).toEqual([tenantA.organisationId]);
    expect(result.branches).toEqual([]);
  });

  it('tenant context does not leak to the next transaction on a reused pooled connection', async () => {
    const single = createDatabase(testDb.runtimeUrl, { maxConnections: 1 });
    try {
      const inside = await withTenantContext(single.db, tenantA, (tx) =>
        tx.select().from(branches),
      );
      expect(inside).toHaveLength(1);
      expect(await single.db.select().from(branches)).toEqual([]);
    } finally {
      await single.close();
    }
  });
});

describe('writing', () => {
  it('rejects inserting a row that belongs to another tenant', async () => {
    await expectPgError(
      withTenantContext(db, tenantA, (tx) =>
        tx.insert(branches).values({ organisationId: tenantB.organisationId, name: 'Smuggled' }),
      ),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('updates and deletes cannot reach another tenant’s rows', async () => {
    await withTenantContext(db, tenantA, async (tx) => {
      const updated = await tx
        .update(branches)
        .set({ name: 'Hijacked' })
        .where(eq(branches.id, tenantB.branchId))
        .returning();
      const deleted = await tx
        .delete(branches)
        .where(eq(branches.id, tenantB.branchId))
        .returning();
      expect(updated).toEqual([]);
      expect(deleted).toEqual([]);
    });
    const [branchB] = await withTenantContext(db, tenantB, (tx) =>
      tx.select().from(branches).where(eq(branches.id, tenantB.branchId)),
    );
    expect(branchB?.name).toBe('jinja-fish-co head office');
  });

  it('cannot move an own row into another tenant', async () => {
    await expectPgError(
      withTenantContext(db, tenantA, (tx) =>
        tx
          .update(branches)
          .set({ organisationId: tenantB.organisationId })
          .where(eq(branches.id, tenantA.branchId)),
      ),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('composite foreign keys block references to another tenant’s records', async () => {
    // Own organisation_id, but pointing at tenant B's role: the FK (organisation_id, role_id)
    // has no matching parent, so the database refuses it regardless of application code.
    await expectPgError(
      withTenantContext(db, tenantA, (tx) =>
        tx.insert(membershipRoles).values({
          organisationId: tenantA.organisationId,
          membershipId: tenantA.membershipId,
          roleId: tenantB.roleId,
        }),
      ),
      SQLSTATE.foreignKeyViolation,
    );
  });

  it('prevents overlapping live subscriptions for the same product', async () => {
    const subscription = {
      organisationId: tenantA.organisationId,
      planCode: 'samakios_pilot',
      productCode: 'samakios',
      status: 'active' as const,
      startsAt: new Date('2026-11-01T00:00:00Z'),
    };
    await expectPgError(
      withTenantContext(db, tenantA, async (tx) => {
        await tx.insert(subscriptions).values(subscription);
        await tx.insert(subscriptions).values(subscription);
      }),
      SQLSTATE.exclusionViolation,
    );
  });
});

describe('audit log', () => {
  const entry = (tenant: Tenant) => ({
    organisationId: tenant.organisationId,
    actorUserId: tenant.userId,
    actorType: 'user' as const,
    action: 'branch.created',
    entityType: 'branch',
    entityId: tenant.branchId,
  });

  it('is append-only for the runtime role', async () => {
    const id = newId();
    await withTenantContext(db, tenantA, (tx) =>
      tx.insert(auditLog).values({ id, ...entry(tenantA) }),
    );
    await expectPgError(
      withTenantContext(db, tenantA, (tx) =>
        tx.update(auditLog).set({ action: 'tampered' }).where(eq(auditLog.id, id)),
      ),
      SQLSTATE.insufficientPrivilege,
    );
    await expectPgError(
      withTenantContext(db, tenantA, (tx) => tx.delete(auditLog).where(eq(auditLog.id, id))),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('is visible only to its own tenant, and cannot be written for another tenant', async () => {
    const seenByB = await withTenantContext(db, tenantB, (tx) =>
      tx.select().from(auditLog).where(eq(auditLog.organisationId, tenantA.organisationId)),
    );
    expect(seenByB).toEqual([]);
    await expectPgError(
      withTenantContext(db, tenantB, (tx) => tx.insert(auditLog).values(entry(tenantA))),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('cannot be read through a partition directly (bypassing the parent’s RLS)', async () => {
    await expectPgError(
      db.execute(sql`select * from audit.audit_log_default`),
      SQLSTATE.insufficientPrivilege,
    );
  });
});

describe('privileges and catalogue checks', () => {
  it('reference data is read-only for the runtime role', async () => {
    expect((await db.select().from(currencies)).length).toBeGreaterThan(0);
    await expectPgError(
      db.insert(currencies).values({ code: 'XXX', name: 'Fake', minorUnits: 2 }),
      SQLSTATE.insufficientPrivilege,
    );
  });

  it('the stock ledger and batches are append-only for the runtime role', async () => {
    const privileges = await db.execute<{ table: string; privilege: string; granted: boolean }>(
      sql`select t.name as table, p.name as privilege,
                 has_table_privilege('app_runtime', t.name, p.name) as granted
          from unnest(array['ops.inventory_movements', 'ops.batches']) as t(name)
          cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(name)`,
    );
    const granted = privileges.rows
      .filter((row) => row.granted)
      .map((row) => `${row.table}:${row.privilege}`)
      .sort();
    expect(granted).toEqual([
      'ops.batches:INSERT',
      'ops.batches:SELECT',
      'ops.inventory_movements:INSERT',
      'ops.inventory_movements:SELECT',
    ]);
  });

  it('seeds the correct currency minor units (UGX and RWF have none)', async () => {
    const rows = await db.select().from(currencies);
    const minor = Object.fromEntries(rows.map((r) => [r.code, r.minorUnits]));
    expect(minor).toMatchObject({ KES: 2, TZS: 2, UGX: 0, RWF: 0 });
  });

  it('every tenant-scoped table (tenancy, system, audit, ops) has RLS enabled, forced and a policy', async () => {
    // Tables intentionally outside RLS, each with a documented reason (DATABASE.md §5).
    const allowlist = ['system.outbox_events'];
    const result = await db.execute<{ table_name: string }>(sql`
      select n.nspname || '.' || c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('tenancy', 'system', 'audit', 'ops')
        and c.relkind in ('r', 'p')
        and not c.relispartition
        and (
          not c.relrowsecurity
          or not c.relforcerowsecurity
          or not exists (select 1 from pg_policy p where p.polrelid = c.oid)
        )
    `);
    const unprotected = result.rows.map((r) => r.table_name).filter((t) => !allowlist.includes(t));
    expect(unprotected).toEqual([]);
  });

  it('rejects a malformed tenant ID before it reaches the database', async () => {
    await expect(
      withTenantContext(db, { organisationId: 'not-a-uuid' as Id, userId: null }, async () => 0),
    ).rejects.toThrow(TypeError);
  });
});
