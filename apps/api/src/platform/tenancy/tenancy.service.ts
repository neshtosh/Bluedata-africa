import {
  isPermissionKey,
  isSystemRoleKey,
  SYSTEM_ROLES,
  type CreateOrganisation,
  type InviteMember,
  type OrganisationSummary,
  type PermissionKey,
} from '@blue/contracts';
import {
  countries,
  membershipRoles,
  memberships,
  organisations,
  organisationTypeAssignments,
  organisationTypes,
  rolePermissions,
  roles,
  subscriptions,
  users,
  withTenantContext,
  type DatabaseHandle,
  type Transaction,
} from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../../kernel/config/app-config.js';
import { RequestContext } from '../../kernel/context/request-context.js';
import { DATABASE } from '../../kernel/database/database.token.js';
import { pgError, UNIQUE_VIOLATION } from '../../kernel/database/pg-error.js';
import { TenantDatabase } from '../../kernel/database/tenant-database.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { OutboxService } from '../../kernel/outbox/outbox.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { ProductCode } from '../access/access-policy.js';
import { issueSetupToken, setupPath } from '../identity/setup-tokens.js';
import { maskPhone } from '../identity/sms-sender.js';

/** What a member may do in one organisation, resolved once per request by the AccessGuard. */
export interface OrganisationAccess {
  membershipId: Id;
  roleKeys: string[];
  permissions: ReadonlySet<PermissionKey>;
  products: ReadonlySet<ProductCode>;
}

const ENTITLED_STATUSES = ['trialing', 'active'] as const;
const PILOT_PRODUCTS: ProductCode[] = ['samakios', 'bluedata'];

@Injectable()
export class TenancyService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(TenantDatabase) private readonly tenantDb: TenantDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Membership, permissions and entitled products of a user in an organisation, or null if they
   * are not an active member. Only organisation-wide role assignments count here; branch-scoped
   * assignments are applied by branch-aware endpoints (Phase 3).
   */
  loadAccess(userId: Id, organisationId: Id): Promise<OrganisationAccess | null> {
    return withTenantContext(this.database.db, { organisationId, userId }, async (tx) => {
      const [membership] = await tx
        .select({ id: memberships.id, status: memberships.status })
        .from(memberships)
        .where(and(eq(memberships.organisationId, organisationId), eq(memberships.userId, userId)));
      if (!membership || membership.status !== 'active') return null;

      const assigned = await tx
        .select({ roleId: roles.id, roleKey: roles.key, isSystem: roles.isSystem })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(
          and(eq(membershipRoles.membershipId, membership.id), isNull(membershipRoles.branchId)),
        );

      // System roles take their permissions from the code registry (always current); custom
      // roles from their stored grants.
      const permissionKeys = new Set<PermissionKey>();
      const customRoleIds: string[] = [];
      for (const role of assigned) {
        if (role.isSystem && isSystemRoleKey(role.roleKey)) {
          for (const key of SYSTEM_ROLES[role.roleKey].permissions) permissionKeys.add(key);
        } else {
          customRoleIds.push(role.roleId);
        }
      }
      if (customRoleIds.length > 0) {
        const grants = await tx
          .select({ permission: rolePermissions.permissionKey })
          .from(rolePermissions)
          .where(inArray(rolePermissions.roleId, customRoleIds));
        for (const grant of grants) {
          if (isPermissionKey(grant.permission)) permissionKeys.add(grant.permission);
        }
      }

      const now = new Date();
      const entitled = await tx
        .select({ product: subscriptions.productCode })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.organisationId, organisationId),
            inArray(subscriptions.status, [...ENTITLED_STATUSES]),
            lte(subscriptions.startsAt, now),
            or(isNull(subscriptions.endsAt), gt(subscriptions.endsAt, now)),
          ),
        );

      return {
        membershipId: membership.id as Id,
        roleKeys: [...new Set(assigned.map((r) => r.roleKey))],
        permissions: permissionKeys,
        products: new Set(entitled.map((s) => s.product as ProductCode)),
      };
    });
  }

  /**
   * Registers an organisation with the caller as Owner — all in one transaction: organisation,
   * types, system roles, owner membership, pilot subscriptions, audit entry and event.
   */
  async register(input: CreateOrganisation): Promise<OrganisationSummary> {
    const [country] = await this.database.db
      .select()
      .from(countries)
      .where(eq(countries.code, input.countryCode));
    if (!country?.isActive) {
      throw new AppError({
        status: 422,
        code: 'COUNTRY_NOT_SUPPORTED',
        title: 'Country not supported yet',
        detail: `Sign-ups are not open in ${input.countryCode} yet.`,
      });
    }
    const knownTypes = await this.database.db
      .select({ code: organisationTypes.code })
      .from(organisationTypes)
      .where(inArray(organisationTypes.code, input.organisationTypes));
    const unknown = input.organisationTypes.filter((t) => !knownTypes.some((k) => k.code === t));
    if (unknown.length > 0) {
      throw AppError.validation(
        unknown.map((code) => ({
          path: 'organisationTypes',
          code: 'unknown_type',
          message: `Unknown organisation type: ${code}`,
        })),
      );
    }

    const context = RequestContext.require();
    const organisationId = newId();
    // The rest of this request is about the new organisation: scope the transaction, audit
    // entry and event to it.
    return RequestContext.run({ ...context, organisationId }, () =>
      this.tenantDb
        .inTenant(async (tx) => {
          const [organisation] = await tx
            .insert(organisations)
            .values({
              id: organisationId,
              legalName: input.legalName,
              tradingName: input.tradingName ?? null,
              slug: input.slug,
              countryCode: country.code,
              defaultCurrency: country.defaultCurrency,
              timezone: country.defaultTimezone,
            })
            .returning();
          if (!organisation) throw new Error('organisation insert returned no row');

          await tx.insert(organisationTypeAssignments).values(
            [...new Set(input.organisationTypes)].map((typeCode) => ({
              organisationId,
              typeCode,
            })),
          );
          const roleIds = await this.createSystemRoles(tx, organisationId);

          const membershipId = newId();
          await tx.insert(memberships).values({
            id: membershipId,
            organisationId,
            userId: requireUser(context),
            status: 'active',
            joinedAt: new Date(),
          });
          await tx.insert(membershipRoles).values({
            organisationId,
            membershipId,
            roleId: roleIds.owner,
          });

          // Pilot entitlements until commercial plans exist (placeholder, see PROJECT_STATUS).
          await tx.insert(subscriptions).values(
            PILOT_PRODUCTS.map((product) => ({
              organisationId,
              planCode: `${product}_pilot`,
              productCode: product,
              status: 'trialing' as const,
              startsAt: new Date(),
            })),
          );

          await this.audit.record(tx, {
            action: 'organisation.registered',
            entityType: 'organisation',
            entityId: organisationId,
            changes: { countryCode: country.code, organisationTypes: input.organisationTypes },
          });
          await this.outbox.enqueue(tx, {
            eventType: 'organisation.registered',
            aggregateType: 'organisation',
            aggregateId: organisationId,
            payload: { organisationId, countryCode: country.code },
          });
          return toSummary(organisation);
        })
        .catch((error: unknown) => {
          const { code, constraint } = pgError(error);
          if (code === UNIQUE_VIOLATION && constraint === 'organisations_slug_unique') {
            throw new AppError({
              status: 409,
              code: 'SLUG_TAKEN',
              title: 'Organisation handle already taken',
              detail: `Choose a different slug than "${input.slug}".`,
            });
          }
          throw error;
        }),
    );
  }

  /** The caller's organisations and pending invitations, with what they may do in each. */
  async listMine(userId: Id) {
    const rows = await this.tenantDb.asUser((tx) =>
      tx
        .select({ organisation: organisations, status: memberships.status })
        .from(memberships)
        .innerJoin(organisations, eq(organisations.id, memberships.organisationId))
        .where(
          and(eq(memberships.userId, userId), inArray(memberships.status, ['active', 'invited'])),
        ),
    );
    return Promise.all(
      rows.map(async ({ organisation, status }) => {
        const access =
          status === 'active' ? await this.loadAccess(userId, organisation.id as Id) : null;
        return {
          organisation: toSummary(organisation),
          membershipStatus: status,
          roles: access?.roleKeys ?? [],
          permissions: access ? [...access.permissions].sort() : [],
          products: access ? [...access.products].sort() : [],
        };
      }),
    );
  }

  /** The organisation in the current tenant context. */
  async current(): Promise<OrganisationSummary> {
    const [organisation] = await this.tenantDb.inTenant((tx) => tx.select().from(organisations));
    if (!organisation) throw AppError.notFound();
    return toSummary(organisation);
  }

  async listMembers() {
    const rows = await this.tenantDb.inTenant((tx) =>
      tx
        .select({
          membershipId: memberships.id,
          userId: memberships.userId,
          status: memberships.status,
          displayName: users.displayName,
          phone: users.phoneE164,
          roleKey: roles.key,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(membershipRoles, eq(membershipRoles.membershipId, memberships.id))
        .leftJoin(roles, eq(roles.id, membershipRoles.roleId)),
    );
    const byMembership = new Map<
      string,
      {
        membershipId: string;
        userId: string;
        status: string;
        displayName: string;
        phone: string | null;
        roles: string[];
      }
    >();
    for (const row of rows) {
      const entry = byMembership.get(row.membershipId) ?? {
        membershipId: row.membershipId,
        userId: row.userId,
        status: row.status,
        displayName: row.displayName,
        phone: row.phone ? maskPhone(row.phone) : null,
        roles: [],
      };
      if (row.roleKey && !entry.roles.includes(row.roleKey)) entry.roles.push(row.roleKey);
      byMembership.set(row.membershipId, entry);
    }
    return [...byMembership.values()];
  }

  /** Invites a person by phone; creates their (unverified) account if they don't have one yet. */
  invite(input: InviteMember): Promise<{ membershipId: Id; status: 'invited' }> {
    const context = RequestContext.require();
    return this.tenantDb.inTenant(async (tx) => {
      const organisationId = requireOrganisation(context);
      let [invitee] = await tx.select().from(users).where(eq(users.phoneE164, input.phone));
      if (!invitee) {
        [invitee] = await tx
          .insert(users)
          .values({ id: newId(), displayName: input.displayName, phoneE164: input.phone })
          .returning();
      }
      if (!invitee) throw new Error('user insert returned no row');

      const [existing] = await tx
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.organisationId, organisationId), eq(memberships.userId, invitee.id)),
        );
      if (existing && existing.status !== 'removed') {
        throw new AppError({
          status: 409,
          code: 'ALREADY_MEMBER',
          title: 'Already a member',
          detail: 'This person is already a member of, or invited to, this organisation.',
        });
      }

      const roleRows = await tx
        .select({ id: roles.id, key: roles.key })
        .from(roles)
        .where(and(eq(roles.organisationId, organisationId), inArray(roles.key, input.roleKeys)));
      if (roleRows.length !== new Set(input.roleKeys).size) {
        throw new Error('system roles missing for organisation'); // created at registration
      }

      const membershipId = (existing?.id as Id | undefined) ?? newId();
      if (existing) {
        await tx
          .update(memberships)
          .set({ status: 'invited', invitedBy: requireUser(context), joinedAt: null })
          .where(eq(memberships.id, existing.id));
        await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, existing.id));
      } else {
        await tx.insert(memberships).values({
          id: membershipId,
          organisationId,
          userId: invitee.id,
          status: 'invited',
          invitedBy: requireUser(context),
        });
      }
      await tx
        .insert(membershipRoles)
        .values(roleRows.map((role) => ({ organisationId, membershipId, roleId: role.id })));

      await this.audit.record(tx, {
        action: 'membership.invited',
        entityType: 'membership',
        entityId: membershipId,
        changes: { userId: invitee.id, roleKeys: input.roleKeys },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'membership.invited',
        aggregateType: 'membership',
        aggregateId: membershipId,
        payload: { membershipId, userId: invitee.id },
      });
      return { membershipId, status: 'invited' as const };
    });
  }

  /** The signed-in user accepts their pending invitation to an organisation. */
  /**
   * A one-time setup link for a member of this organisation who has never signed in (ADR-019).
   * People who have signed in before may belong to other organisations, so a link from here
   * could take over their account elsewhere; their password resets go through the operator.
   */
  async createSetupLink(userId: Id): Promise<{ path: string; expiresAt: string }> {
    const context = RequestContext.require();
    const [membership] = await this.tenantDb.inTenant((tx) =>
      tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.userId, userId), inArray(memberships.status, ['active', 'invited'])),
        ),
    );
    if (!membership) throw AppError.notFound('This person is not a member of this organisation.');
    const [user] = await this.database.db
      .select({ lastLoginAt: users.lastLoginAt, status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    if (!user || user.status !== 'active' || user.lastLoginAt !== null) {
      throw new AppError({
        status: 409,
        code: 'SETUP_LINK_NOT_ALLOWED',
        title: 'This person has already signed in',
        detail:
          'Setup links are only for people who have not signed in yet. If they forgot their password, ask the platform operator for a reset link.',
      });
    }
    const organisationId = context.organisationId as Id;
    const { token, expiresAt } = await issueSetupToken(
      this.database.db,
      this.config.AUTH_SECRET,
      this.config.SETUP_LINK_TTL_HOURS,
      { userId, organisationId, createdByUserId: requireUser(context) },
    );
    await this.tenantDb.inTenant((tx) =>
      this.audit.record(tx, {
        action: 'membership.setup_link_created',
        entityType: 'membership',
        entityId: membership.id as Id,
        changes: { userId, expiresAt: expiresAt.toISOString() },
      }),
    );
    return { path: setupPath(token), expiresAt: expiresAt.toISOString() };
  }

  acceptInvitation(organisationId: Id): Promise<{ membershipId: Id; status: 'active' }> {
    const context = RequestContext.require();
    return RequestContext.run({ ...context, organisationId }, () =>
      this.tenantDb.inTenant(async (tx) => {
        const [accepted] = await tx
          .update(memberships)
          .set({ status: 'active', joinedAt: new Date() })
          .where(
            and(
              eq(memberships.organisationId, organisationId),
              eq(memberships.userId, requireUser(context)),
              eq(memberships.status, 'invited'),
            ),
          )
          .returning({ id: memberships.id });
        if (!accepted) throw AppError.notFound('No pending invitation to this organisation.');
        await this.audit.record(tx, {
          action: 'membership.accepted',
          entityType: 'membership',
          entityId: accepted.id as Id,
        });
        return { membershipId: accepted.id as Id, status: 'active' as const };
      }),
    );
  }

  private async createSystemRoles(tx: Transaction, organisationId: Id) {
    const ids = {} as Record<keyof typeof SYSTEM_ROLES, Id>;
    for (const [key, template] of Object.entries(SYSTEM_ROLES) as [
      keyof typeof SYSTEM_ROLES,
      (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES],
    ][]) {
      const id = newId();
      ids[key] = id;
      await tx.insert(roles).values({
        id,
        organisationId,
        key,
        name: template.name,
        description: template.description,
        isSystem: true,
      });
      // No role_permissions rows: system role permissions come from the code registry.
    }
    return ids;
  }
}

function toSummary(organisation: typeof organisations.$inferSelect): OrganisationSummary {
  return {
    id: organisation.id,
    legalName: organisation.legalName,
    tradingName: organisation.tradingName,
    slug: organisation.slug,
    countryCode: organisation.countryCode,
    defaultCurrency: organisation.defaultCurrency,
  };
}

function requireUser(context: { userId: Id | null }): Id {
  if (!context.userId) throw new Error('expected a signed-in user in request context');
  return context.userId;
}

function requireOrganisation(context: { organisationId: Id | null }): Id {
  if (!context.organisationId) throw new Error('expected an organisation in request context');
  return context.organisationId;
}
