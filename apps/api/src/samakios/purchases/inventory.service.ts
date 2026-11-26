import type { Batch, ListBatchesQuerySchema, StockSummary } from '@blue/contracts';
import {
  batches,
  inventoryBalances,
  purchaseLines,
  purchases,
  type Transaction,
} from '@blue/database';
import { parseFixed } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, lte, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { TenantDatabase } from '../../kernel/database/tenant-database.js';
import { normaliseDecimal } from '../../platform/reference/reference.service.js';
import { formatMoney, orgSettings, type OrgSettings } from '../shared/trading-rules.js';
import { sumKg } from './purchases.service.js';

type ListQuery = z.output<typeof ListBatchesQuerySchema>;

/** Grams as an integer, for exact ratios: "46.25" → 46250n. */
const grams = (kg: string) => parseFixed(kg, 3).units;

/** a × b / c rounded half up, all bigint (amounts are never negative here). */
const mulDiv = (a: bigint, b: bigint, c: bigint) => (c === 0n ? 0n : (a * b + c / 2n) / c);

/** Stock on hand by batch, read from the balances the purchase transaction maintains. */
@Injectable()
export class InventoryService {
  constructor(@Inject(TenantDatabase) private readonly tenantDb: TenantDatabase) {}

  batches(query: ListQuery): Promise<Batch[]> {
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const rows = await batchRows(tx, [
        query.inStock === false ? undefined : gt(inventoryBalances.quantityKg, '0'),
        query.catalogueItemId ? eq(batches.catalogueItemId, query.catalogueItemId) : undefined,
      ]);
      return rows.map((row) => toDto(row, settings));
    });
  }

  summary(): Promise<StockSummary> {
    return this.tenantDb.inTenant(async (tx) => {
      const settings = await orgSettings(tx);
      const inStock = await batchRows(tx, [gt(inventoryBalances.quantityKg, '0')]);
      const byItem = new Map<string, { kg: string[]; cost: bigint; batches: number }>();
      let totalCost = 0n;
      for (const row of inStock) {
        // Only stock in the organisation's currency is valued; other currencies would need FX.
        const cost =
          row.currency === settings.currency
            ? onHandCost(row.costMinor, row.received, row.onHand)
            : 0n;
        totalCost += cost;
        const entry = byItem.get(row.catalogueItemId) ?? { kg: [], cost: 0n, batches: 0 };
        entry.kg.push(row.onHand);
        entry.cost += cost;
        entry.batches += 1;
        byItem.set(row.catalogueItemId, entry);
      }

      const weekStart = daysBefore(settings.today, 6);
      const [week] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          totalMinor: sql<string>`coalesce(sum(${purchases.totalMinor}), 0)::text`,
        })
        .from(purchases)
        .where(
          and(
            eq(purchases.status, 'confirmed'),
            eq(purchases.currency, settings.currency),
            gte(purchases.purchaseDate, weekStart),
            lte(purchases.purchaseDate, settings.today),
          ),
        );

      const money = (minor: bigint) => formatMoney(minor, settings.currency, settings);
      return {
        currency: settings.currency,
        onHandKg: sumKg(inStock.map((r) => r.onHand)),
        onHandCost: money(totalCost),
        items: [...byItem.entries()].map(([catalogueItemId, entry]) => ({
          catalogueItemId,
          onHandKg: sumKg(entry.kg),
          onHandCost: money(entry.cost),
          batches: entry.batches,
        })),
        purchasesLast7Days: {
          count: week?.count ?? 0,
          total: money(BigInt(week?.totalMinor ?? '0')),
        },
      };
    });
  }
}

function batchRows(tx: Transaction, filters: (SQL | undefined)[]) {
  return tx
    .select({
      id: batches.id,
      number: batches.number,
      catalogueItemId: batches.catalogueItemId,
      origin: batches.origin,
      supplierPartnerId: batches.supplierPartnerId,
      catchOrHarvestDate: batches.catchOrHarvestDate,
      receivedOn: batches.receivedOn,
      received: batches.quantityKgReceived,
      onHand: inventoryBalances.quantityKg,
      costMinor: batches.costMinor,
      currency: batches.currency,
      purchaseId: purchases.id,
      purchaseNumber: purchases.number,
    })
    .from(batches)
    .innerJoin(inventoryBalances, eq(inventoryBalances.batchId, batches.id))
    .leftJoin(purchaseLines, eq(purchaseLines.id, batches.purchaseLineId))
    .leftJoin(purchases, eq(purchases.id, purchaseLines.purchaseId))
    .where(and(...filters))
    .orderBy(desc(batches.receivedOn), desc(batches.number));
}

/** The cost of what is left of a batch, pro rata by weight. */
function onHandCost(costMinor: bigint, receivedKg: string, onHandKg: string): bigint {
  return mulDiv(costMinor, grams(onHandKg), grams(receivedKg));
}

/** YYYY-MM-DD minus n days, in calendar arithmetic (no timezone involved). */
export function daysBefore(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() - days);
  return at.toISOString().slice(0, 10);
}

function toDto(row: Awaited<ReturnType<typeof batchRows>>[number], settings: OrgSettings): Batch {
  return {
    id: row.id,
    number: row.number,
    catalogueItemId: row.catalogueItemId,
    origin: row.origin,
    supplierPartnerId: row.supplierPartnerId,
    purchase:
      row.purchaseId && row.purchaseNumber
        ? { id: row.purchaseId, number: row.purchaseNumber }
        : null,
    catchOrHarvestDate: row.catchOrHarvestDate,
    receivedOn: row.receivedOn,
    quantityKgReceived: normaliseDecimal(row.received),
    quantityKgOnHand: normaliseDecimal(row.onHand),
    cost: formatMoney(row.costMinor, row.currency, settings),
    // Minor units per kg: cost × 1000 g / received grams.
    costPerKg: formatMoney(
      mulDiv(row.costMinor, 1000n, grams(row.received)),
      row.currency,
      settings,
    ),
    currency: row.currency,
  };
}
