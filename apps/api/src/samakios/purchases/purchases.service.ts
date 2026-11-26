import type {
  CreatePurchaseSchema,
  ListPurchasesQuerySchema,
  Purchase,
  SupplyOrigin,
} from '@blue/contracts';
import {
  batches,
  catalogueItems,
  documentSequences,
  inventoryBalances,
  inventoryMovements,
  purchaseLines,
  purchases,
  supplyRecords,
  tradingPartners,
  type Transaction,
} from '@blue/database';
import { add, formatFixed, lineTotal, newId, parseFixed, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { TenantDatabase } from '../../kernel/database/tenant-database.js';
import { AppError, type FieldError } from '../../kernel/errors/app-error.js';
import { OutboxService } from '../../kernel/outbox/outbox.service.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { normaliseDecimal, ReferenceService } from '../../platform/reference/reference.service.js';
import {
  formatMoney,
  kilograms,
  orgSettings,
  priceToMinor,
  type OrgSettings,
} from '../shared/trading-rules.js';

type CreateInput = z.output<typeof CreatePurchaseSchema>;
type ListQuery = z.output<typeof ListPurchasesQuerySchema>;
type PurchaseRow = typeof purchases.$inferSelect;
type LineRow = typeof purchaseLines.$inferSelect;
type SupplyRow = typeof supplyRecords.$inferSelect;

/**
 * Purchases (DATABASE.md §3.5 "Trading"): a spot purchase is recorded and received in one
 * step; a planned purchase is a draft until the fish arrives. Receiving creates one batch per
 * line, a `receipt` movement in the append-only stock ledger and the batch's balance, all in
 * the purchase's transaction, and marks any supply offers it takes up as purchased.
 */
@Injectable()
export class PurchasesService {
  constructor(
    @Inject(TenantDatabase) private readonly tenantDb: TenantDatabase,
    @Inject(ReferenceService) private readonly reference: ReferenceService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  list(query: ListQuery): Promise<Purchase[]> {
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const filters: (SQL | undefined)[] = [
        query.status ? eq(purchases.status, query.status) : undefined,
        query.partnerId ? eq(purchases.partnerId, query.partnerId) : undefined,
        query.from ? gte(purchases.purchaseDate, query.from) : undefined,
        query.to ? lte(purchases.purchaseDate, query.to) : undefined,
      ];
      const rows = await tx
        .select()
        .from(purchases)
        .where(and(...filters))
        .orderBy(desc(purchases.purchaseDate), desc(purchases.createdAt));
      return withLines(tx, rows, settings);
    });
  }

  async create(input: CreateInput): Promise<Purchase> {
    const vocabulary = await this.reference.vocabulary();
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const purchaseDate = input.purchaseDate ?? settings.today;
      const errors: FieldError[] = [];

      const [partner] = await tx
        .select()
        .from(tradingPartners)
        .where(eq(tradingPartners.id, input.partnerId));
      if (!partner) {
        errors.push({ path: 'partnerId', code: 'unknown', message: 'Unknown supplier' });
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
      if (input.receiveNow && purchaseDate > settings.today) {
        errors.push({
          path: 'purchaseDate',
          code: 'in_future',
          message: 'Fish received now cannot have a future purchase date',
        });
      }

      const itemIds = [...new Set(input.lines.map((l) => l.catalogueItemId))];
      const items = await tx
        .select()
        .from(catalogueItems)
        .where(inArray(catalogueItems.id, itemIds));
      const offerIds = input.lines.flatMap((l) => (l.supplyRecordId ? [l.supplyRecordId] : []));
      const offers = offerIds.length
        ? await tx
            .select()
            .from(supplyRecords)
            .where(inArray(supplyRecords.id, offerIds))
            .for('update')
        : [];
      const offersInUse = await offersOnOpenPurchases(tx, offerIds);

      const prepared: (Omit<typeof purchaseLines.$inferInsert, 'purchaseId'> & {
        offer: SupplyRow | undefined;
      })[] = [];
      for (const [index, line] of input.lines.entries()) {
        const path = `lines.${index}`;
        const item = items.find((i) => i.id === line.catalogueItemId);
        if (!item) {
          errors.push({
            path: `${path}.catalogueItemId`,
            code: 'unknown',
            message: 'Unknown item',
          });
          continue;
        }
        if (item.archivedAt) {
          errors.push({
            path: `${path}.catalogueItemId`,
            code: 'archived',
            message: `${item.name} is archived`,
          });
          continue;
        }
        const offer = line.supplyRecordId
          ? offers.find((o) => o.id === line.supplyRecordId)
          : undefined;
        if (line.supplyRecordId) {
          const problem = !offer
            ? 'Unknown supply offer'
            : offer.status !== 'available' && offer.status !== 'reserved'
              ? `That offer is ${offer.status}`
              : offer.partnerId !== input.partnerId
                ? 'That offer is from a different supplier'
                : offer.catalogueItemId !== item.id
                  ? 'That offer is for a different item'
                  : offersInUse.has(offer.id)
                    ? 'That offer is already on another purchase'
                    : null;
          if (problem) {
            errors.push({ path: `${path}.supplyRecordId`, code: 'unavailable', message: problem });
            continue;
          }
        }
        const productionType = partner?.productionType;
        const origin: SupplyOrigin | undefined =
          line.origin ??
          offer?.origin ??
          (productionType === 'wild' || productionType === 'farmed' ? productionType : undefined);
        if (!origin) {
          errors.push({
            path: `${path}.origin`,
            code: 'required',
            message: 'Say whether this fish is wild-caught or farmed',
          });
          continue;
        }
        const unitCode = line.unitCode ?? offer?.unitCode ?? item.defaultUnitCode;
        const quantityKg = await kilograms(
          tx,
          vocabulary.units,
          item,
          unitCode,
          line.quantity,
          path,
        );
        const unitPriceMinor = priceToMinor(
          line.unitPrice,
          settings.currency,
          settings,
          `${path}.unitPrice`,
        );
        prepared.push({
          id: newId(),
          organisationId: '',
          lineNo: index + 1,
          catalogueItemId: item.id,
          supplyRecordId: offer?.id ?? null,
          origin,
          quantity: line.quantity,
          unitCode,
          quantityKg,
          unitPriceMinor,
          lineTotalMinor: lineTotal(line.quantity, unitPriceMinor),
          offer,
        });
      }
      if (errors.length > 0 || !partner) throw AppError.validation(errors);

      const id = newId();
      const totalMinor = prepared.reduce((sum, l) => sum + (l.lineTotalMinor ?? 0n), 0n);
      const [purchase] = await tx
        .insert(purchases)
        .values({
          id,
          organisationId: sql`app.current_org_id()`,
          number: await nextNumber(tx, 'purchase', 'PO', purchaseDate),
          partnerId: partner.id,
          purchaseDate,
          currency: settings.currency,
          totalMinor,
          location: input.location ?? partner.landingSite,
          notes: input.notes ?? null,
        })
        .returning();
      if (!purchase) throw new Error('purchase insert returned no row');
      const lines = await tx
        .insert(purchaseLines)
        .values(
          prepared.map(({ offer: _offer, ...line }) => ({
            ...line,
            organisationId: purchase.organisationId,
            purchaseId: id,
          })),
        )
        .returning();

      await this.audit.record(tx, {
        action: 'purchase.created',
        entityType: 'purchase',
        entityId: id,
        changes: {
          number: purchase.number,
          partnerId: partner.id,
          purchaseDate,
          total: formatMoney(totalMinor, settings.currency, settings),
          currency: settings.currency,
          lines: lines.length,
          receiveNow: input.receiveNow,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'purchase.created',
        aggregateType: 'purchase',
        aggregateId: id,
        payload: { purchaseId: id, number: purchase.number, status: 'draft' },
      });

      const final = input.receiveNow
        ? await this.receive(tx, purchase, lines, purchaseDate, settings)
        : purchase;
      return (await withLines(tx, [final], settings))[0] as Purchase;
    });
  }

  confirm(purchaseId: Id, version: number): Promise<Purchase> {
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const purchase = await lockDraft(tx, purchaseId, version, 'confirm');
      const lines = await tx
        .select()
        .from(purchaseLines)
        .where(eq(purchaseLines.purchaseId, purchaseId))
        .orderBy(asc(purchaseLines.lineNo));
      const final = await this.receive(tx, purchase, lines, settings.today, settings);
      return (await withLines(tx, [final], settings))[0] as Purchase;
    });
  }

  cancel(purchaseId: Id, version: number): Promise<Purchase> {
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const purchase = await lockDraft(tx, purchaseId, version, 'cancel');
      const [cancelled] = await tx
        .update(purchases)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          version: sql`${purchases.version} + 1`,
        })
        .where(eq(purchases.id, purchase.id))
        .returning();
      if (!cancelled) throw new Error('purchase cancel matched no row despite lock');
      await this.audit.record(tx, {
        action: 'purchase.cancelled',
        entityType: 'purchase',
        entityId: purchase.id as Id,
        changes: { number: purchase.number },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'purchase.cancelled',
        aggregateType: 'purchase',
        aggregateId: purchase.id as Id,
        payload: { purchaseId: purchase.id, number: purchase.number },
      });
      return (await withLines(tx, [cancelled], settings))[0] as Purchase;
    });
  }

  /**
   * Receives a draft purchase into stock: a batch, a receipt movement and a balance per line;
   * supply offers taken up become `purchased`. Runs inside the caller's transaction, so either
   * everything is received or nothing is.
   */
  private async receive(
    tx: Transaction,
    purchase: PurchaseRow,
    lines: LineRow[],
    receivedOn: string,
    settings: OrgSettings,
  ): Promise<PurchaseRow> {
    const offerIds = lines.flatMap((l) => (l.supplyRecordId ? [l.supplyRecordId] : []));
    const offers = offerIds.length
      ? await tx
          .select()
          .from(supplyRecords)
          .where(inArray(supplyRecords.id, offerIds))
          .for('update')
      : [];
    const batchNumbers: string[] = [];
    for (const line of lines) {
      const offer = offers.find((o) => o.id === line.supplyRecordId);
      if (offer && offer.status !== 'available' && offer.status !== 'reserved') {
        throw new AppError({
          status: 409,
          code: 'SUPPLY_RECORD_UNAVAILABLE',
          title: 'A supply offer on this purchase is no longer open',
          detail: `Line ${line.lineNo} takes up an offer that is now ${offer.status}. Cancel this purchase and record a new one.`,
        });
      }
      const batchId = newId();
      const number = await nextNumber(tx, 'batch', 'B', purchase.purchaseDate);
      batchNumbers.push(number);
      // A landing date after the purchase date would be a typo in the offer; never go later.
      const caught =
        offer && offer.availableFrom < purchase.purchaseDate
          ? offer.availableFrom
          : purchase.purchaseDate;
      await tx.insert(batches).values({
        id: batchId,
        organisationId: purchase.organisationId,
        number,
        catalogueItemId: line.catalogueItemId,
        origin: line.origin,
        supplierPartnerId: purchase.partnerId,
        purchaseLineId: line.id,
        catchOrHarvestDate: caught,
        receivedOn,
        quantityKgReceived: line.quantityKg,
        costMinor: line.lineTotalMinor,
        currency: purchase.currency,
      });
      await tx.insert(inventoryMovements).values({
        id: newId(),
        organisationId: purchase.organisationId,
        batchId,
        movementType: 'receipt',
        quantityKg: line.quantityKg,
        referenceType: 'purchase',
        referenceId: purchase.id,
      });
      await tx.insert(inventoryBalances).values({
        organisationId: purchase.organisationId,
        batchId,
        quantityKg: line.quantityKg,
      });
    }
    if (offerIds.length > 0) {
      await tx
        .update(supplyRecords)
        .set({ status: 'purchased', version: sql`${supplyRecords.version} + 1` })
        .where(inArray(supplyRecords.id, offerIds));
    }
    const [confirmed] = await tx
      .update(purchases)
      .set({ status: 'confirmed', confirmedAt: new Date(), version: sql`${purchases.version} + 1` })
      .where(eq(purchases.id, purchase.id))
      .returning();
    if (!confirmed) throw new Error('purchase confirm matched no row');

    await this.audit.record(tx, {
      action: 'purchase.confirmed',
      entityType: 'purchase',
      entityId: purchase.id as Id,
      changes: { number: purchase.number, receivedOn, batches: batchNumbers, offers: offerIds },
    });
    await this.outbox.enqueue(tx, {
      eventType: 'purchase.confirmed',
      aggregateType: 'purchase',
      aggregateId: purchase.id as Id,
      payload: {
        purchaseId: purchase.id,
        number: purchase.number,
        partnerId: purchase.partnerId,
        total: formatMoney(purchase.totalMinor, purchase.currency, settings),
        currency: purchase.currency,
        batches: batchNumbers,
      },
    });
    return confirmed;
  }
}

async function lockDraft(
  tx: Transaction,
  purchaseId: Id,
  version: number,
  action: 'confirm' | 'cancel',
): Promise<PurchaseRow> {
  const [purchase] = await tx
    .select()
    .from(purchases)
    .where(eq(purchases.id, purchaseId))
    .for('update');
  if (!purchase) throw AppError.notFound();
  if (purchase.version !== version) {
    throw new AppError({
      status: 412,
      code: 'STALE_VERSION',
      title: 'This purchase was changed by someone else',
      detail: `You last saw version ${version}; the current version is ${purchase.version}. Reload and try again.`,
    });
  }
  if (purchase.status !== 'draft') {
    throw new AppError({
      status: 409,
      code: 'PURCHASE_NOT_DRAFT',
      title: `This purchase is already ${purchase.status}`,
      detail: `Only draft purchases can be ${action === 'confirm' ? 'confirmed' : 'cancelled'}.`,
    });
  }
  return purchase;
}

/** Offers already on a draft or confirmed purchase (cancelled purchases release them). */
async function offersOnOpenPurchases(tx: Transaction, offerIds: string[]): Promise<Set<string>> {
  if (offerIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: purchaseLines.supplyRecordId })
    .from(purchaseLines)
    .innerJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
    .where(and(inArray(purchaseLines.supplyRecordId, offerIds), ne(purchases.status, 'cancelled')));
  return new Set(rows.flatMap((r) => (r.id ? [r.id] : [])));
}

/**
 * Next document number for the organisation, per type and year: PO-2026-000001. The sequence
 * row is created on first use and incremented under its row lock, so numbers never repeat.
 */
async function nextNumber(
  tx: Transaction,
  documentType: string,
  prefix: string,
  date: string,
): Promise<string> {
  const period = date.slice(0, 4);
  const [row] = await tx
    .insert(documentSequences)
    .values({ organisationId: sql`app.current_org_id()`, documentType, period, nextValue: 2 })
    .onConflictDoUpdate({
      target: [
        documentSequences.organisationId,
        documentSequences.documentType,
        documentSequences.period,
      ],
      set: { nextValue: sql`${documentSequences.nextValue} + 1` },
    })
    .returning({ value: sql<string>`${documentSequences.nextValue} - 1` });
  if (!row) throw new Error('document sequence returned no row');
  return `${prefix}-${period}-${String(row.value).padStart(6, '0')}`;
}

async function withLines(
  tx: Transaction,
  rows: PurchaseRow[],
  settings: OrgSettings,
): Promise<Purchase[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const lines = await tx
    .select()
    .from(purchaseLines)
    .where(inArray(purchaseLines.purchaseId, ids))
    .orderBy(asc(purchaseLines.lineNo));
  const lineIds = lines.map((l) => l.id);
  const lineBatches = lineIds.length
    ? await tx
        .select({ id: batches.id, number: batches.number, lineId: batches.purchaseLineId })
        .from(batches)
        .where(inArray(batches.purchaseLineId, lineIds))
    : [];
  return rows.map((row) => {
    const own = lines.filter((l) => l.purchaseId === row.id);
    const money = (minor: bigint) => formatMoney(minor, row.currency, settings);
    return {
      id: row.id,
      number: row.number,
      partnerId: row.partnerId,
      purchaseDate: row.purchaseDate,
      status: row.status,
      currency: row.currency,
      total: money(row.totalMinor),
      totalKg: sumKg(own.map((l) => l.quantityKg)),
      location: row.location,
      notes: row.notes,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      lines: own.map((line) => {
        const batch = lineBatches.find((b) => b.lineId === line.id);
        return {
          id: line.id,
          lineNo: line.lineNo,
          catalogueItemId: line.catalogueItemId,
          supplyRecordId: line.supplyRecordId,
          origin: line.origin,
          quantity: normaliseDecimal(line.quantity),
          unitCode: line.unitCode,
          quantityKg: normaliseDecimal(line.quantityKg),
          unitPrice: money(line.unitPriceMinor),
          lineTotal: money(line.lineTotalMinor),
          batch: batch ? { id: batch.id, number: batch.number } : null,
        };
      }),
      version: row.version,
    };
  });
}

/** Exact sum of kilogram strings, normalised ("46.250" + "3" → "49.25"). */
export function sumKg(values: string[]): string {
  const total = values.reduce((sum, kg) => add(sum, parseFixed(kg, 3)), parseFixed('0', 3));
  return normaliseDecimal(formatFixed(total));
}
