import type {
  CreateTradingPartnerSchema,
  ListTradingPartnersQuerySchema,
  PartnerRole,
  TradingPartner,
  UpdateTradingPartnerSchema,
} from '@blue/contracts';
import { partnerSpecies, tradingPartners, type Transaction } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, exists, ilike, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { pgError, UNIQUE_VIOLATION } from '../../kernel/database/pg-error.js';
import { TenantDatabase } from '../../kernel/database/tenant-database.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { OutboxService } from '../../kernel/outbox/outbox.service.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { ReferenceService } from '../../platform/reference/reference.service.js';

type CreateInput = z.output<typeof CreateTradingPartnerSchema>;
type UpdateInput = z.output<typeof UpdateTradingPartnerSchema>;
type ListQuery = z.output<typeof ListTradingPartnersQuerySchema>;
type PartnerRow = typeof tradingPartners.$inferSelect;

const ROLE_COLUMNS = {
  supplier: tradingPartners.isSupplier,
  buyer: tradingPartners.isBuyer,
  transporter: tradingPartners.isTransporter,
} as const;

/** Escapes LIKE wildcards so user text is matched literally. */
const likeLiteral = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Trading partners (DATABASE.md §3.5): one record per party, whatever roles it plays.
 * Records belong to the organisation and are never shared or merged across tenants.
 */
@Injectable()
export class PartnersService {
  constructor(
    @Inject(TenantDatabase) private readonly tenantDb: TenantDatabase,
    @Inject(ReferenceService) private readonly reference: ReferenceService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  list(query: ListQuery): Promise<TradingPartner[]> {
    return this.tenantDb.inTenant(async (tx) => {
      const filters: (SQL | undefined)[] = [
        query.includeArchived ? undefined : isNull(tradingPartners.archivedAt),
        query.role ? eq(ROLE_COLUMNS[query.role], true) : undefined,
      ];
      if (query.q) {
        // Leading zeros dropped so the local form 0711… finds +254711….
        const digits = query.q.replace(/\D/g, '').replace(/^0+/, '');
        filters.push(
          or(
            ilike(tradingPartners.name, `%${likeLiteral(query.q)}%`),
            // Phone search needs a few digits, so "7" doesn't match everyone.
            digits.length >= 3 ? like(tradingPartners.phoneE164, `%${digits}%`) : undefined,
          ),
        );
      }
      if (query.speciesId) {
        filters.push(
          exists(
            tx
              .select({ one: sql`1` })
              .from(partnerSpecies)
              .where(
                and(
                  eq(partnerSpecies.partnerId, tradingPartners.id),
                  eq(partnerSpecies.speciesId, query.speciesId),
                ),
              ),
          ),
        );
      }
      const rows = await tx
        .select()
        .from(tradingPartners)
        .where(and(...filters))
        .orderBy(asc(tradingPartners.name));
      const links = await tx.select().from(partnerSpecies);
      return rows.map((row) => toDto(row, speciesOf(links, row.id)));
    });
  }

  async create(input: CreateInput): Promise<TradingPartner> {
    await this.assertSpeciesExist(input.speciesIds);
    return this.tenantDb
      .inTenant(async (tx) => {
        const id = newId();
        const [row] = await tx
          .insert(tradingPartners)
          .values({
            id,
            organisationId: sql`app.current_org_id()`,
            kind: input.kind,
            name: input.name,
            phoneE164: input.phone ?? null,
            ...roleFlags(input.roles),
            productionType: input.productionType ?? null,
            landingSite: input.landingSite ?? null,
            notes: input.notes ?? null,
          })
          .returning();
        if (!row) throw new Error('partner insert returned no row');
        const speciesIds = await replaceSpecies(tx, row.organisationId, id, input.speciesIds);
        // Audit records which fields were set, not the personal data itself.
        await this.audit.record(tx, {
          action: 'trading_partner.created',
          entityType: 'trading_partner',
          entityId: id,
          changes: { kind: input.kind, roles: input.roles, speciesIds },
        });
        await this.outbox.enqueue(tx, {
          eventType: 'trading_partner.created',
          aggregateType: 'trading_partner',
          aggregateId: id,
          payload: { partnerId: id, roles: input.roles },
        });
        return toDto(row, speciesIds);
      })
      .catch((error: unknown) => this.rethrowDuplicatePhone(error, input.phone ?? null));
  }

  async update(partnerId: Id, input: UpdateInput): Promise<TradingPartner> {
    if (input.speciesIds) await this.assertSpeciesExist(input.speciesIds);
    return this.tenantDb
      .inTenant(async (tx) => {
        const [current] = await tx
          .select()
          .from(tradingPartners)
          .where(eq(tradingPartners.id, partnerId))
          .for('update');
        if (!current) throw AppError.notFound();
        if (current.version !== input.version) {
          throw new AppError({
            status: 412,
            code: 'STALE_VERSION',
            title: 'This partner was changed by someone else',
            detail: `You edited version ${input.version}; the current version is ${current.version}. Reload and try again.`,
          });
        }

        const [row] = await tx
          .update(tradingPartners)
          .set({
            ...(input.kind === undefined ? {} : { kind: input.kind }),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.phone === undefined ? {} : { phoneE164: input.phone }),
            ...(input.roles === undefined ? {} : roleFlags(input.roles)),
            ...(input.productionType === undefined ? {} : { productionType: input.productionType }),
            ...(input.landingSite === undefined ? {} : { landingSite: input.landingSite }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.archived === undefined
              ? {}
              : { archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null }),
            version: sql`${tradingPartners.version} + 1`,
          })
          .where(eq(tradingPartners.id, partnerId))
          .returning();
        if (!row) throw new Error('partner update matched no row despite lock');

        const speciesIds = input.speciesIds
          ? await replaceSpecies(tx, current.organisationId, partnerId, input.speciesIds)
          : speciesOf(
              await tx.select().from(partnerSpecies).where(eq(partnerSpecies.partnerId, partnerId)),
              partnerId,
            );

        await this.audit.record(tx, {
          action: input.archived === true ? 'trading_partner.archived' : 'trading_partner.updated',
          entityType: 'trading_partner',
          entityId: partnerId,
          // Field names only: values may be personal data (name, phone).
          changes: { fields: Object.keys(input).filter((key) => key !== 'version') },
        });
        await this.outbox.enqueue(tx, {
          eventType: 'trading_partner.updated',
          aggregateType: 'trading_partner',
          aggregateId: partnerId,
          payload: { partnerId, version: row.version },
        });
        return toDto(row, speciesIds);
      })
      .catch((error: unknown) => this.rethrowDuplicatePhone(error, input.phone ?? null));
  }

  private async assertSpeciesExist(speciesIds: string[]): Promise<void> {
    if (speciesIds.length === 0) return;
    const known = new Set((await this.reference.vocabulary()).species.map((s) => s.id));
    const unknown = speciesIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw AppError.validation(
        unknown.map((id) => ({
          path: 'speciesIds',
          code: 'unknown',
          message: `Unknown species ${id}`,
        })),
      );
    }
  }

  /** Turns the unique-phone violation into a helpful conflict that names the existing partner. */
  private async rethrowDuplicatePhone(error: unknown, phone: string | null): Promise<never> {
    const { code, constraint } = pgError(error);
    if (code !== UNIQUE_VIOLATION || constraint !== 'trading_partners_org_phone_key' || !phone) {
      throw error;
    }
    const [existing] = await this.tenantDb.inTenant((tx) =>
      tx
        .select({ name: tradingPartners.name, archivedAt: tradingPartners.archivedAt })
        .from(tradingPartners)
        .where(eq(tradingPartners.phoneE164, phone)),
    );
    throw new AppError({
      status: 409,
      code: 'PARTNER_PHONE_EXISTS',
      title: 'This phone number already belongs to a partner',
      detail: existing
        ? `${existing.name}${existing.archivedAt ? ' (archived)' : ''} already uses this number. Edit that partner instead of adding a duplicate.`
        : 'Another partner already uses this number.',
    });
  }
}

function roleFlags(roles: PartnerRole[]) {
  return {
    isSupplier: roles.includes('supplier'),
    isBuyer: roles.includes('buyer'),
    isTransporter: roles.includes('transporter'),
  };
}

async function replaceSpecies(
  tx: Transaction,
  organisationId: string,
  partnerId: string,
  speciesIds: string[],
): Promise<string[]> {
  const unique = [...new Set(speciesIds)];
  await tx.delete(partnerSpecies).where(eq(partnerSpecies.partnerId, partnerId));
  if (unique.length > 0) {
    await tx
      .insert(partnerSpecies)
      .values(unique.map((speciesId) => ({ organisationId, partnerId, speciesId })));
  }
  return unique;
}

function speciesOf(links: { partnerId: string; speciesId: string }[], partnerId: string): string[] {
  return links.filter((link) => link.partnerId === partnerId).map((link) => link.speciesId);
}

function toDto(row: PartnerRow, speciesIds: string[]): TradingPartner {
  const roles: PartnerRole[] = [];
  if (row.isSupplier) roles.push('supplier');
  if (row.isBuyer) roles.push('buyer');
  if (row.isTransporter) roles.push('transporter');
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    phone: row.phoneE164,
    roles,
    productionType: row.productionType,
    landingSite: row.landingSite,
    notes: row.notes,
    speciesIds,
    archived: row.archivedAt !== null,
    version: row.version,
  };
}
