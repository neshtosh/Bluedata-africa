import type { Unit, Vocabulary } from '@blue/contracts';
import { productForms, species, speciesNames, units, type DatabaseHandle } from '@blue/database';
import { Inject, Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { DATABASE } from '../../kernel/database/database.token.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

/** Strips trailing zeros from a numeric(…) string: "18.500000" → "18.5", "1.000000" → "1". */
export function normaliseDecimal(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

/**
 * Global fisheries vocabulary (ref schema): read-only, the same for every organisation, and
 * changed only by seeds on deploy — so it is cached in memory for a few minutes.
 */
@Injectable()
export class ReferenceService {
  private cache: { value: Vocabulary; expiresAt: number } | undefined;

  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async vocabulary(): Promise<Vocabulary> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const db = this.database.db;
    const [speciesRows, nameRows, formRows, unitRows] = await Promise.all([
      db.select().from(species).orderBy(asc(species.commonNameEn)),
      db.select().from(speciesNames).orderBy(asc(speciesNames.name)),
      db.select().from(productForms).orderBy(asc(productForms.name)),
      db.select().from(units).orderBy(asc(units.dimension), asc(units.code)),
    ]);
    const value: Vocabulary = {
      species: speciesRows.map((s) => ({
        id: s.id,
        scientificName: s.scientificName,
        commonNameEn: s.commonNameEn,
        family: s.family,
        habitat: s.habitat,
        farmed: s.farmed,
        names: nameRows
          .filter((n) => n.speciesId === s.id)
          .map((n) => ({ language: n.language, countryCode: n.countryCode, name: n.name })),
      })),
      productForms: formRows.map((f) => ({ code: f.code, name: f.name })),
      units: unitRows.map((u): Unit => ({
        code: u.code,
        name: u.name,
        dimension: u.dimension,
        kgFactor: u.kgFactor === null ? null : normaliseDecimal(u.kgFactor),
      })),
    };
    this.cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  }
}
