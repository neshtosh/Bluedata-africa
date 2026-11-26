import { z } from 'zod';
import { Uuid } from './common.js';
import { IsoDate, MoneyAmount, Quantity, SUPPLY_ORIGINS } from './supply.js';

export const PURCHASE_STATUSES = ['draft', 'confirmed', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PurchaseLineSchema = z.object({
  id: Uuid,
  lineNo: z.number().int(),
  catalogueItemId: Uuid,
  supplyRecordId: Uuid.nullable(),
  origin: z.enum(SUPPLY_ORIGINS),
  quantity: z.string(),
  unitCode: z.string(),
  quantityKg: z.string(),
  /** Per `unitCode`, in major units of the purchase currency. */
  unitPrice: z.string(),
  lineTotal: z.string(),
  /** The stock batch created when the purchase was confirmed. */
  batch: z.object({ id: Uuid, number: z.string() }).nullable(),
});
export type PurchaseLine = z.infer<typeof PurchaseLineSchema>;

export const PurchaseSchema = z.object({
  id: Uuid,
  number: z.string(),
  partnerId: Uuid,
  purchaseDate: IsoDate,
  status: z.enum(PURCHASE_STATUSES),
  currency: z.string(),
  total: z.string(),
  totalKg: z.string(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  confirmedAt: z.iso.datetime({ offset: true }).nullable(),
  lines: z.array(PurchaseLineSchema),
  version: z.number().int(),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

const Text = (max: number) => z.string().trim().min(1).max(max);

export const CreatePurchaseLineSchema = z.strictObject({
  catalogueItemId: Uuid,
  quantity: Quantity,
  /** Defaults to the catalogue item's default unit. */
  unitCode: z.string().min(1).max(20).optional(),
  /** Price per unit, in the organisation's currency. Zero is allowed (e.g. a gift or sample). */
  unitPrice: MoneyAmount,
  /** Defaults to the supply offer's origin, else the supplier's production type. */
  origin: z.enum(SUPPLY_ORIGINS).optional(),
  /** The supplier's open offer this line takes up; it is marked purchased on confirmation. */
  supplyRecordId: Uuid.optional(),
});
export type CreatePurchaseLine = z.input<typeof CreatePurchaseLineSchema>;

export const CreatePurchaseSchema = z.strictObject({
  partnerId: Uuid,
  /** Defaults to today in the organisation's timezone. */
  purchaseDate: IsoDate.optional(),
  /**
   * true (default): a spot purchase, received into stock now. false: a planned purchase, saved
   * as a draft and confirmed when the fish arrives.
   */
  receiveNow: z.boolean().default(true),
  location: Text(160).optional(),
  notes: Text(1000).optional(),
  lines: z
    .array(CreatePurchaseLineSchema)
    .min(1, 'Add at least one line')
    .max(50)
    .refine(
      (lines) => {
        const offers = lines.flatMap((l) => (l.supplyRecordId ? [l.supplyRecordId] : []));
        return new Set(offers).size === offers.length;
      },
      { message: 'Each supply offer can be used on one line only' },
    ),
});
export type CreatePurchase = z.input<typeof CreatePurchaseSchema>;

/** Confirm (receive) or cancel a draft: send the version you last read. */
export const PurchaseActionSchema = z.strictObject({ version: z.number().int().positive() });

export const ListPurchasesQuerySchema = z.object({
  status: z.enum(PURCHASE_STATUSES).optional(),
  partnerId: Uuid.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

// --- Inventory ---

export const BatchSchema = z.object({
  id: Uuid,
  number: z.string(),
  catalogueItemId: Uuid,
  origin: z.enum(SUPPLY_ORIGINS),
  supplierPartnerId: Uuid.nullable(),
  purchase: z.object({ id: Uuid, number: z.string() }).nullable(),
  catchOrHarvestDate: IsoDate,
  receivedOn: IsoDate,
  quantityKgReceived: z.string(),
  quantityKgOnHand: z.string(),
  cost: z.string(),
  /** cost / kg received, rounded to the currency's minor unit (display only). */
  costPerKg: z.string(),
  currency: z.string(),
});
export type Batch = z.infer<typeof BatchSchema>;

export const ListBatchesQuerySchema = z.object({
  catalogueItemId: Uuid.optional(),
  /** Default true: only batches with stock left. */
  inStock: z.stringbool().optional(),
});

export const StockSummarySchema = z.object({
  currency: z.string(),
  /** Total kilograms on hand across all batches. */
  onHandKg: z.string(),
  /** Cost of the stock on hand, pro rata by kg per batch. */
  onHandCost: z.string(),
  items: z.array(
    z.object({
      catalogueItemId: Uuid,
      onHandKg: z.string(),
      onHandCost: z.string(),
      batches: z.number().int(),
    }),
  ),
  /** Confirmed purchases dated in the last 7 days (including today). */
  purchasesLast7Days: z.object({ count: z.number().int(), total: z.string() }),
});
export type StockSummary = z.infer<typeof StockSummarySchema>;
