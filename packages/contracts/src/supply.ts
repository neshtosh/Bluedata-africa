import { z } from 'zod';
import { Uuid } from './common.js';

export const SUPPLY_ORIGINS = ['wild', 'farmed'] as const;
export const SUPPLY_STATUSES = ['available', 'reserved', 'purchased', 'withdrawn'] as const;
/** Statuses a user may set. `purchased` is set only by recording a purchase. */
export const SETTABLE_SUPPLY_STATUSES = ['available', 'reserved', 'withdrawn'] as const;

export type SupplyOrigin = (typeof SUPPLY_ORIGINS)[number];
export type SupplyStatus = (typeof SUPPLY_STATUSES)[number];

/** A quantity as entered, as a decimal string (ADR-008): positive, up to 3 decimal places. */
export const Quantity = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'Use a number like 2.5')
  .refine((value) => Number(value) > 0, 'Must be more than 0');

/**
 * A money amount in major units as typed ("350", "1500.50"). Whether the decimals are allowed
 * depends on the currency (UGX and RWF have none), so the server checks that part.
 */
export const MoneyAmount = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,4})?$/, 'Use a number like 350 or 350.50');

/** Calendar date, YYYY-MM-DD. */
export const IsoDate = z.iso.date();

export const SupplyRecordSchema = z.object({
  id: Uuid,
  partnerId: Uuid,
  catalogueItemId: Uuid,
  origin: z.enum(SUPPLY_ORIGINS),
  quantity: z.string(),
  unitCode: z.string(),
  /** The quantity in kilograms, using the organisation's unit weights when it was recorded. */
  quantityKg: z.string(),
  availableFrom: IsoDate,
  availableUntil: IsoDate.nullable(),
  /** Asking price per `unitCode`, in major units of `currency`. */
  askingPrice: z.string().nullable(),
  currency: z.string().nullable(),
  location: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(SUPPLY_STATUSES),
  /** Available or reserved, but `availableUntil` has passed. */
  expired: z.boolean(),
  version: z.number().int(),
});
export type SupplyRecord = z.infer<typeof SupplyRecordSchema>;

const Text = (max: number) => z.string().trim().min(1).max(max);

export const CreateSupplyRecordSchema = z.strictObject({
  partnerId: Uuid,
  catalogueItemId: Uuid,
  /** Defaults to the supplier's production type when that is wild or farmed. */
  origin: z.enum(SUPPLY_ORIGINS).optional(),
  quantity: Quantity,
  /** Defaults to the catalogue item's default unit. */
  unitCode: z.string().min(1).max(20).optional(),
  availableFrom: IsoDate,
  availableUntil: IsoDate.optional(),
  /** In the organisation's default currency, per unit. */
  askingPrice: MoneyAmount.optional(),
  /** Defaults to the supplier's landing site. */
  location: Text(160).optional(),
  notes: Text(1000).optional(),
});
export type CreateSupplyRecord = z.input<typeof CreateSupplyRecordSchema>;

export const UpdateSupplyRecordSchema = z.strictObject({
  /** Optimistic concurrency: the version you last read. */
  version: z.number().int().positive(),
  quantity: Quantity.optional(),
  availableFrom: IsoDate.optional(),
  availableUntil: IsoDate.nullable().optional(),
  askingPrice: MoneyAmount.nullable().optional(),
  location: Text(160).nullable().optional(),
  notes: Text(1000).nullable().optional(),
  status: z.enum(SETTABLE_SUPPLY_STATUSES).optional(),
});
export type UpdateSupplyRecord = z.input<typeof UpdateSupplyRecordSchema>;

export const ListSupplyRecordsQuerySchema = z.object({
  /** `open` (default): available or reserved. `closed`: purchased or withdrawn. */
  state: z.enum(['open', 'closed', 'all']).optional(),
  partnerId: Uuid.optional(),
  catalogueItemId: Uuid.optional(),
  origin: z.enum(SUPPLY_ORIGINS).optional(),
});
