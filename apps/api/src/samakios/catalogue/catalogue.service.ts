import type {
  CatalogueItem,
  CreateCatalogueItemSchema,
  UpdateCatalogueItemSchema,
} from '@blue/contracts';
import { catalogueItems, catalogueItemUnits, type Transaction } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { pgError, UNIQUE_VIOLATION } from '../../kernel/database/pg-error.js';
import { TenantDatabase } from '../../kernel/database/tenant-database.js';
import { AppError, type FieldError } from '../../kernel/errors/app-error.js';
import { OutboxService } from '../../kernel/outbox/outbox.service.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { normaliseDecimal, ReferenceService } from '../../platform/reference/reference.service.js';

type CreateInput = z.output<typeof CreateCatalogueItemSchema>;
type UpdateInput = z.output<typeof UpdateCatalogueItemSchema>;
type ItemUnit = { unitCode: string; kgPerUnit: string };

/**
 * The organisation's catalogue (DATABASE.md §3.5): what it trades, and how much its own
 * containers of each item weigh. Every quantity recorded later is converted to kg through this,
 * so the rules below guarantee a conversion always exists.
 */
@Injectable()
export class CatalogueService {
  constructor(
    @Inject(TenantDatabase) private readonly tenantDb: TenantDatabase,
    @Inject(ReferenceService) private readonly reference: ReferenceService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  list(includeArchived: boolean): Promise<CatalogueItem[]> {
    return this.tenantDb.inTenant(async (tx) => {
      const items = await tx
        .select()
        .from(catalogueItems)
        .where(includeArchived ? undefined : isNull(catalogueItems.archivedAt))
        .orderBy(asc(catalogueItems.name));
      const itemUnits = await tx.select().from(catalogueItemUnits);
      return items.map((item) =>
        toDto(
          item,
          itemUnits.filter((u) => u.catalogueItemId === item.id),
        ),
      );
    });
  }

  async create(input: CreateInput): Promise<CatalogueItem> {
    const vocabulary = await this.reference.vocabulary();
    const speciesRow = vocabulary.species.find((s) => s.id === input.speciesId);
    const form = vocabulary.productForms.find((f) => f.code === input.productFormCode);
    const errors: FieldError[] = [];
    if (!speciesRow)
      errors.push({ path: 'speciesId', code: 'unknown', message: 'Unknown species' });
    if (!form)
      errors.push({ path: 'productFormCode', code: 'unknown', message: 'Unknown product form' });
    errors.push(...unitErrors(input.defaultUnitCode, input.units, vocabulary.units));
    if (errors.length > 0 || !speciesRow || !form) throw AppError.validation(errors);

    const name =
      input.name ??
      [`${speciesRow.commonNameEn} — ${form.name}`, input.grade, input.sizeClass]
        .filter(Boolean)
        .join(', ');

    return this.tenantDb
      .inTenant(async (tx) => {
        const id = newId();
        const [item] = await tx
          .insert(catalogueItems)
          .values({
            id,
            organisationId: sql`app.current_org_id()`,
            name,
            speciesId: input.speciesId,
            productFormCode: input.productFormCode,
            grade: input.grade ?? null,
            sizeClass: input.sizeClass ?? null,
            defaultUnitCode: input.defaultUnitCode,
          })
          .returning();
        if (!item) throw new Error('catalogue insert returned no row');
        const saved = await replaceUnits(tx, item.organisationId, id, input.units);
        await this.audit.record(tx, {
          action: 'catalogue_item.created',
          entityType: 'catalogue_item',
          entityId: id,
          changes: {
            speciesId: input.speciesId,
            productFormCode: input.productFormCode,
            units: input.units,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: 'catalogue_item.created',
          aggregateType: 'catalogue_item',
          aggregateId: id,
          payload: {
            catalogueItemId: id,
            speciesId: input.speciesId,
            productFormCode: input.productFormCode,
          },
        });
        return toDto(item, saved);
      })
      .catch(rethrowDuplicate);
  }

  async update(itemId: Id, input: UpdateInput): Promise<CatalogueItem> {
    const vocabulary = await this.reference.vocabulary();
    return this.tenantDb
      .inTenant(async (tx) => {
        const [current] = await tx
          .select()
          .from(catalogueItems)
          .where(eq(catalogueItems.id, itemId))
          .for('update');
        if (!current) throw AppError.notFound();
        if (current.version !== input.version) {
          throw new AppError({
            status: 412,
            code: 'STALE_VERSION',
            title: 'This item was changed by someone else',
            detail: `You edited version ${input.version}; the current version is ${current.version}. Reload and try again.`,
          });
        }

        const currentUnits = await tx
          .select()
          .from(catalogueItemUnits)
          .where(eq(catalogueItemUnits.catalogueItemId, itemId));
        const nextUnits: ItemUnit[] =
          input.units ??
          currentUnits.map((u) => ({ unitCode: u.unitCode, kgPerUnit: u.kgPerUnit }));
        const nextDefault = input.defaultUnitCode ?? current.defaultUnitCode;
        const errors = unitErrors(nextDefault, nextUnits, vocabulary.units);
        if (errors.length > 0) throw AppError.validation(errors);

        const [updated] = await tx
          .update(catalogueItems)
          .set({
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.grade === undefined ? {} : { grade: input.grade }),
            ...(input.sizeClass === undefined ? {} : { sizeClass: input.sizeClass }),
            defaultUnitCode: nextDefault,
            ...(input.archived === undefined
              ? {}
              : { archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null }),
            version: sql`${catalogueItems.version} + 1`,
          })
          .where(and(eq(catalogueItems.id, itemId), eq(catalogueItems.version, current.version)))
          .returning();
        if (!updated) throw new Error('catalogue update matched no row despite lock');
        const savedUnits = input.units
          ? await replaceUnits(tx, current.organisationId, itemId, input.units)
          : currentUnits;

        const { version: _version, ...changes } = input;
        await this.audit.record(tx, {
          action: input.archived === true ? 'catalogue_item.archived' : 'catalogue_item.updated',
          entityType: 'catalogue_item',
          entityId: itemId,
          changes,
        });
        await this.outbox.enqueue(tx, {
          eventType: 'catalogue_item.updated',
          aggregateType: 'catalogue_item',
          aggregateId: itemId,
          payload: { catalogueItemId: itemId, version: updated.version },
        });
        return toDto(updated, savedUnits);
      })
      .catch(rethrowDuplicate);
  }
}

/**
 * Unit rules: units must exist; only count/container units get organisation weights (mass units
 * are fixed); no duplicates; and the default unit must be convertible to kg.
 */
function unitErrors(
  defaultUnitCode: string,
  itemUnits: ItemUnit[],
  known: { code: string; dimension: string }[],
): FieldError[] {
  const errors: FieldError[] = [];
  const byCode = new Map(known.map((u) => [u.code, u]));
  const seen = new Set<string>();
  itemUnits.forEach((unit, index) => {
    const ref = byCode.get(unit.unitCode);
    if (!ref) {
      errors.push({
        path: `units.${index}.unitCode`,
        code: 'unknown',
        message: `Unknown unit "${unit.unitCode}"`,
      });
    } else if (ref.dimension === 'mass') {
      errors.push({
        path: `units.${index}.unitCode`,
        code: 'fixed_weight',
        message: `${ref.code} has a fixed weight and can't be given a custom one`,
      });
    }
    if (seen.has(unit.unitCode)) {
      errors.push({
        path: `units.${index}.unitCode`,
        code: 'duplicate',
        message: `${unit.unitCode} is listed twice`,
      });
    }
    seen.add(unit.unitCode);
  });
  const defaultUnit = byCode.get(defaultUnitCode);
  if (!defaultUnit) {
    errors.push({
      path: 'defaultUnitCode',
      code: 'unknown',
      message: `Unknown unit "${defaultUnitCode}"`,
    });
  } else if (
    defaultUnit.dimension !== 'mass' &&
    !itemUnits.some((u) => u.unitCode === defaultUnitCode)
  ) {
    errors.push({
      path: 'defaultUnitCode',
      code: 'no_weight',
      message: `Record how many kg a ${defaultUnit.code} of this item weighs before making it the default`,
    });
  }
  return errors;
}

async function replaceUnits(
  tx: Transaction,
  organisationId: string,
  itemId: string,
  itemUnits: ItemUnit[],
) {
  await tx.delete(catalogueItemUnits).where(eq(catalogueItemUnits.catalogueItemId, itemId));
  if (itemUnits.length === 0) return [];
  return tx
    .insert(catalogueItemUnits)
    .values(
      itemUnits.map((u) => ({
        organisationId,
        catalogueItemId: itemId,
        unitCode: u.unitCode,
        kgPerUnit: u.kgPerUnit,
      })),
    )
    .returning();
}

function toDto(item: typeof catalogueItems.$inferSelect, itemUnits: ItemUnit[]): CatalogueItem {
  return {
    id: item.id,
    name: item.name,
    speciesId: item.speciesId,
    productFormCode: item.productFormCode,
    grade: item.grade,
    sizeClass: item.sizeClass,
    defaultUnitCode: item.defaultUnitCode,
    units: itemUnits.map((u) => ({
      unitCode: u.unitCode,
      kgPerUnit: normaliseDecimal(u.kgPerUnit),
    })),
    archived: item.archivedAt !== null,
    version: item.version,
  };
}

function rethrowDuplicate(error: unknown): never {
  const { code, constraint } = pgError(error);
  if (code === UNIQUE_VIOLATION && constraint === 'catalogue_items_identity_key') {
    throw new AppError({
      status: 409,
      code: 'CATALOGUE_ITEM_EXISTS',
      title: 'This item is already in the catalogue',
      detail:
        'The same species, product form, grade and size class already exist. Edit that item instead.',
    });
  }
  throw error;
}
