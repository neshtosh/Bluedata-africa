import type {
  CreateSupplyRecordSchema,
  ListSupplyRecordsQuerySchema,
  SupplyOrigin,
  SupplyRecord,
  UpdateSupplyRecordSchema,
} from '@blue/contracts';
import {
  catalogueItems,
  catalogueItemUnits,
  countries,
  currencies,
  organisations,
  supplyRecords,
  tradingPartners,
  type Transaction,
} from '@blue/database';
import { formatMinor, newId, toKilograms, toMinor, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { TenantDatabase } from '../../kernel/database/tenant-database.js';
import { AppError, type FieldError } from '../../kernel/errors/app-error.js';
import { OutboxService } from '../../kernel/outbox/outbox.service.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { normaliseDecimal, ReferenceService } from '../../platform/reference/reference.service.js';

type CreateInput = z.output<typeof CreateSupplyRecordSchema>;
type UpdateInput = z.output<typeof UpdateSupplyRecordSchema>;
type ListQuery = z.output<typeof ListSupplyRecordsQuerySchema>;
type SupplyRow = typeof supplyRecords.$inferSelect;

const OPEN = ['available', 'reserved'] as const;
const CLOSED = ['purchased', 'withdrawn'] as const;

/** What a supply record needs to know about its organisation. */
interface OrgSettings {
  currency: string;
  /** Today's date where the organisation is (its country's timezone), YYYY-MM-DD. */
  today: string;
  minorUnits: Map<string, number>;
}

/**
 * Supply records (DATABASE.md §3.5): fish a supplier has or expects, wild or farmed. Purchases
 * (3.4) will consume them; until then they are the trader's view of what is on offer.
 */
@Injectable()
export class SupplyService {
  constructor(
    @Inject(TenantDatabase) private readonly tenantDb: TenantDatabase,
    @Inject(ReferenceService) private readonly reference: ReferenceService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  list(query: ListQuery): Promise<SupplyRecord[]> {
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const state = query.state ?? 'open';
      const filters: (SQL | undefined)[] = [
        state === 'open' ? inArray(supplyRecords.status, [...OPEN]) : undefined,
        state === 'closed' ? inArray(supplyRecords.status, [...CLOSED]) : undefined,
        query.partnerId ? eq(supplyRecords.partnerId, query.partnerId) : undefined,
        query.catalogueItemId
          ? eq(supplyRecords.catalogueItemId, query.catalogueItemId)
          : undefined,
        query.origin ? eq(supplyRecords.origin, query.origin) : undefined,
      ];
      const rows = await tx
        .select()
        .from(supplyRecords)
        .where(and(...filters))
        .orderBy(supplyRecords.availableFrom, desc(supplyRecords.createdAt));
      return rows.map((row) => toDto(row, settings));
    });
  }

  async create(input: CreateInput): Promise<SupplyRecord> {
    const vocabulary = await this.reference.vocabulary();
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const [partner] = await tx
        .select()
        .from(tradingPartners)
        .where(eq(tradingPartners.id, input.partnerId));
      const [item] = await tx
        .select()
        .from(catalogueItems)
        .where(eq(catalogueItems.id, input.catalogueItemId));

      const errors: FieldError[] = [];
      if (!partner) {
        errors.push({ path: 'partnerId', code: 'unknown', message: 'Unknown partner' });
      } else if (partner.archivedAt) {
        errors.push({
          path: 'partnerId',
          code: 'archived',
          message: `${partner.name} is archived`,
        });
      } else if (!partner.isSupplier) {
        errors.push({
          path: 'partnerId',
          code: 'not_supplier',
          message: `${partner.name} is not marked as a supplier`,
        });
      }
      if (!item) {
        errors.push({ path: 'catalogueItemId', code: 'unknown', message: 'Unknown item' });
      } else if (item.archivedAt) {
        errors.push({
          path: 'catalogueItemId',
          code: 'archived',
          message: `${item.name} is archived`,
        });
      }
      const productionType = partner?.productionType;
      const origin: SupplyOrigin | undefined =
        input.origin ??
        (productionType === 'wild' || productionType === 'farmed' ? productionType : undefined);
      if (!origin) {
        errors.push({
          path: 'origin',
          code: 'required',
          message: 'Say whether this fish is wild-caught or farmed',
        });
      }
      errors.push(...dateErrors(input.availableFrom, input.availableUntil ?? null));
      if (errors.length > 0 || !partner || !item || !origin) throw AppError.validation(errors);

      const unitCode = input.unitCode ?? item.defaultUnitCode;
      const quantityKg = await kilograms(tx, vocabulary.units, item, unitCode, input.quantity);
      const askingPriceMinor =
        input.askingPrice === undefined
          ? null
          : priceToMinor(input.askingPrice, settings.currency, settings);

      const id = newId();
      const [row] = await tx
        .insert(supplyRecords)
        .values({
          id,
          organisationId: sql`app.current_org_id()`,
          partnerId: partner.id,
          catalogueItemId: item.id,
          origin,
          quantity: input.quantity,
          unitCode,
          quantityKg,
          availableFrom: input.availableFrom,
          availableUntil: input.availableUntil ?? null,
          askingPriceMinor,
          currency: askingPriceMinor === null ? null : settings.currency,
          location: input.location ?? partner.landingSite,
          notes: input.notes ?? null,
        })
        .returning();
      if (!row) throw new Error('supply insert returned no row');

      await this.audit.record(tx, {
        action: 'supply_record.created',
        entityType: 'supply_record',
        entityId: id,
        changes: {
          partnerId: partner.id,
          catalogueItemId: item.id,
          origin,
          quantity: input.quantity,
          unitCode,
          quantityKg,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'supply_record.created',
        aggregateType: 'supply_record',
        aggregateId: id,
        payload: { supplyRecordId: id, catalogueItemId: item.id, origin, quantityKg },
      });
      return toDto(row, settings);
    });
  }

  async update(supplyRecordId: Id, input: UpdateInput): Promise<SupplyRecord> {
    const vocabulary = await this.reference.vocabulary();
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const [current] = await tx
        .select()
        .from(supplyRecords)
        .where(eq(supplyRecords.id, supplyRecordId))
        .for('update');
      if (!current) throw AppError.notFound();
      if (current.version !== input.version) {
        throw new AppError({
          status: 412,
          code: 'STALE_VERSION',
          title: 'This supply record was changed by someone else',
          detail: `You edited version ${input.version}; the current version is ${current.version}. Reload and try again.`,
        });
      }
      if (current.status === 'purchased' || current.status === 'withdrawn') {
        throw new AppError({
          status: 409,
          code: 'SUPPLY_RECORD_CLOSED',
          title: `This supply record is ${current.status}`,
          detail: 'Purchased and withdrawn records cannot be changed. Record a new offer instead.',
        });
      }

      const availableFrom = input.availableFrom ?? current.availableFrom;
      const availableUntil =
        input.availableUntil === undefined ? current.availableUntil : input.availableUntil;
      const errors = dateErrors(availableFrom, availableUntil);
      if (errors.length > 0) throw AppError.validation(errors);

      let quantityKg = current.quantityKg;
      if (input.quantity !== undefined) {
        const [item] = await tx
          .select()
          .from(catalogueItems)
          .where(eq(catalogueItems.id, current.catalogueItemId));
        if (!item) throw new Error('supply record item vanished despite foreign key');
        quantityKg = await kilograms(tx, vocabulary.units, item, current.unitCode, input.quantity);
      }
      const currency = current.currency ?? settings.currency;
      const price =
        input.askingPrice === undefined
          ? {}
          : input.askingPrice === null
            ? { askingPriceMinor: null, currency: null }
            : { askingPriceMinor: priceToMinor(input.askingPrice, currency, settings), currency };

      const [row] = await tx
        .update(supplyRecords)
        .set({
          ...(input.quantity === undefined ? {} : { quantity: input.quantity, quantityKg }),
          availableFrom,
          availableUntil,
          ...price,
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(input.status === undefined ? {} : { status: input.status }),
          version: sql`${supplyRecords.version} + 1`,
        })
        .where(eq(supplyRecords.id, supplyRecordId))
        .returning();
      if (!row) throw new Error('supply update matched no row despite lock');

      const { version: _version, ...changes } = input;
      await this.audit.record(tx, {
        action:
          input.status && input.status !== current.status
            ? `supply_record.${input.status}`
            : 'supply_record.updated',
        entityType: 'supply_record',
        entityId: supplyRecordId,
        changes: { ...changes, ...(input.quantity === undefined ? {} : { quantityKg }) },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'supply_record.updated',
        aggregateType: 'supply_record',
        aggregateId: supplyRecordId,
        payload: { supplyRecordId, status: row.status, version: row.version },
      });
      return toDto(row, settings);
    });
  }
}

async function orgSettings(tx: Transaction): Promise<OrgSettings> {
  const [org] = await tx
    .select({ currency: organisations.defaultCurrency, timezone: countries.defaultTimezone })
    .from(organisations)
    .innerJoin(countries, eq(countries.code, organisations.countryCode))
    .where(eq(organisations.id, sql`app.current_org_id()`));
  if (!org) throw new Error('organisation not visible in its own tenant context');
  const rows = await tx
    .select({ code: currencies.code, minorUnits: currencies.minorUnits })
    .from(currencies);
  return {
    currency: org.currency,
    today: todayIn(org.timezone),
    minorUnits: new Map(rows.map((r) => [r.code, r.minorUnits])),
  };
}

/** YYYY-MM-DD in an IANA timezone ("en-CA" formats dates that way). */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function dateErrors(from: string, until: string | null): FieldError[] {
  return until !== null && until < from
    ? [
        {
          path: 'availableUntil',
          code: 'before_start',
          message: 'The last day must be on or after the first day',
        },
      ]
    : [];
}

/**
 * Quantity in kg via the unit's fixed factor (kg, g, t) or the organisation's own weight for
 * this item (ADR-017). Refuses units with no weight rather than guessing one.
 */
async function kilograms(
  tx: Transaction,
  knownUnits: { code: string; kgFactor: string | null }[],
  item: typeof catalogueItems.$inferSelect,
  unitCode: string,
  quantity: string,
): Promise<string> {
  const unit = knownUnits.find((u) => u.code === unitCode);
  if (!unit) {
    throw AppError.validation([
      { path: 'unitCode', code: 'unknown', message: `Unknown unit "${unitCode}"` },
    ]);
  }
  let kgPerUnit = unit.kgFactor;
  if (kgPerUnit === null) {
    const [own] = await tx
      .select()
      .from(catalogueItemUnits)
      .where(
        and(
          eq(catalogueItemUnits.catalogueItemId, item.id),
          eq(catalogueItemUnits.unitCode, unitCode),
        ),
      );
    kgPerUnit = own?.kgPerUnit ?? null;
  }
  if (kgPerUnit === null) {
    throw AppError.validation([
      {
        path: 'unitCode',
        code: 'no_weight',
        message: `Record how many kg a ${unit.code} of ${item.name} weighs in the catalogue first`,
      },
    ]);
  }
  const kg = toKilograms(quantity, kgPerUnit);
  if (!/[1-9]/.test(kg)) {
    throw AppError.validation([
      { path: 'quantity', code: 'too_small', message: 'Less than 1 gram; check the quantity' },
    ]);
  }
  return kg;
}

function priceToMinor(amount: string, currency: string, settings: OrgSettings): bigint {
  const minorUnits = settings.minorUnits.get(currency) ?? 2;
  try {
    return toMinor(amount, minorUnits);
  } catch {
    throw AppError.validation([
      {
        path: 'askingPrice',
        code: 'too_precise',
        message:
          minorUnits === 0
            ? `${currency} amounts have no decimals`
            : `${currency} amounts have at most ${minorUnits} decimals`,
      },
    ]);
  }
}

function toDto(row: SupplyRow, settings: OrgSettings): SupplyRecord {
  const open = row.status === 'available' || row.status === 'reserved';
  return {
    id: row.id,
    partnerId: row.partnerId,
    catalogueItemId: row.catalogueItemId,
    origin: row.origin,
    quantity: normaliseDecimal(row.quantity),
    unitCode: row.unitCode,
    quantityKg: normaliseDecimal(row.quantityKg),
    availableFrom: row.availableFrom,
    availableUntil: row.availableUntil,
    askingPrice:
      row.askingPriceMinor === null || row.currency === null
        ? null
        : formatMinor(row.askingPriceMinor, settings.minorUnits.get(row.currency) ?? 2),
    currency: row.currency,
    location: row.location,
    notes: row.notes,
    status: row.status,
    expired: open && row.availableUntil !== null && row.availableUntil < settings.today,
    version: row.version,
  };
}
