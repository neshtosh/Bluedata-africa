import { z } from 'zod';
import { Uuid } from './common.js';

/** Kilograms per unit, as a decimal string (ADR-008): positive, up to 6 decimal places. */
export const KgPerUnit = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,6})?$/, 'Use a number like 18.5 (kg per unit)')
  .refine((value) => Number(value) > 0, 'Must be more than 0 kg');

const OptionalLabel = z.string().trim().min(1).max(60);

// --- Reference vocabulary ---

export const SpeciesSchema = z.object({
  id: Uuid,
  scientificName: z.string(),
  commonNameEn: z.string(),
  family: z.string().nullable(),
  habitat: z.enum(['freshwater', 'marine', 'brackish']),
  farmed: z.boolean(),
  names: z.array(
    z.object({ language: z.string(), countryCode: z.string().nullable(), name: z.string() }),
  ),
});
export type Species = z.infer<typeof SpeciesSchema>;

export const UnitSchema = z.object({
  code: z.string(),
  name: z.string(),
  dimension: z.enum(['mass', 'count', 'container']),
  /** Fixed kg factor for mass units; null for count/container units (weighed per item). */
  kgFactor: z.string().nullable(),
});
export type Unit = z.infer<typeof UnitSchema>;

export const VocabularySchema = z.object({
  species: z.array(SpeciesSchema),
  productForms: z.array(z.object({ code: z.string(), name: z.string() })),
  units: z.array(UnitSchema),
});
export type Vocabulary = z.infer<typeof VocabularySchema>;

// --- Catalogue ---

const ItemUnitSchema = z.object({ unitCode: z.string(), kgPerUnit: KgPerUnit });

export const CatalogueItemSchema = z.object({
  id: Uuid,
  name: z.string(),
  speciesId: Uuid,
  productFormCode: z.string(),
  grade: z.string().nullable(),
  sizeClass: z.string().nullable(),
  defaultUnitCode: z.string(),
  /** The organisation's own weights for count/container units of this item. */
  units: z.array(ItemUnitSchema),
  archived: z.boolean(),
  version: z.number().int(),
});
export type CatalogueItem = z.infer<typeof CatalogueItemSchema>;

export const CreateCatalogueItemSchema = z.strictObject({
  /** Defaults to "<species> — <form>[, grade][, size]". */
  name: z.string().trim().min(1).max(120).optional(),
  speciesId: Uuid,
  productFormCode: z.string().min(1),
  grade: OptionalLabel.optional(),
  sizeClass: OptionalLabel.optional(),
  defaultUnitCode: z.string().min(1),
  units: z
    .array(z.strictObject({ unitCode: z.string().min(1), kgPerUnit: KgPerUnit }))
    .max(10)
    .default([]),
});
export type CreateCatalogueItem = z.input<typeof CreateCatalogueItemSchema>;

export const UpdateCatalogueItemSchema = z.strictObject({
  /** Optimistic concurrency: the version you last read (API.md §1). */
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  grade: OptionalLabel.nullable().optional(),
  sizeClass: OptionalLabel.nullable().optional(),
  defaultUnitCode: z.string().min(1).optional(),
  /** Replaces the item's unit weights when present. */
  units: z
    .array(z.strictObject({ unitCode: z.string().min(1), kgPerUnit: KgPerUnit }))
    .max(10)
    .optional(),
  archived: z.boolean().optional(),
});
export type UpdateCatalogueItem = z.input<typeof UpdateCatalogueItemSchema>;
