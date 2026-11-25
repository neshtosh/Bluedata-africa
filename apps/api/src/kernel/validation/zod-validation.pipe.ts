import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

/**
 * Validates and parses a request part against a Zod schema (ADR: Zod in shared contracts).
 * Use per parameter: `@Body(new ZodValidationPipe(CreateBranchSchema)) body: CreateBranch`.
 * The returned value is the parsed output, so defaults and coercions are applied and unknown
 * keys are stripped or rejected according to the schema (writes should use z.strictObject).
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw AppError.validation(
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
        message: issue.message,
      })),
    );
  }
}
