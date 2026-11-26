import {
  endpoints,
  type CreateSupplyRecordSchema,
  type ListSupplyRecordsQuerySchema,
  type UpdateSupplyRecordSchema,
} from '@blue/contracts';
import type { Id } from '@blue/primitives';
import { Body, Controller, Inject, Module, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { ZodValidationPipe } from '../../kernel/validation/zod-validation.pipe.js';
import { RequirePermission } from '../../platform/access/access-policy.js';
import { SupplyService } from './supply.service.js';

const SAMAKIOS = { product: 'samakios' } as const;

@Controller()
export class SupplyController {
  constructor(@Inject(SupplyService) private readonly supply: SupplyService) {}

  @RequirePermission('samakios.supply.read', SAMAKIOS)
  @Endpoint(endpoints.supply.list)
  list(
    @Query(new ZodValidationPipe(endpoints.supply.list.query))
    query: z.output<typeof ListSupplyRecordsQuerySchema>,
  ) {
    return this.supply.list(query);
  }

  @RequirePermission('samakios.supply.manage', SAMAKIOS)
  @Endpoint(endpoints.supply.create)
  create(
    @Body(new ZodValidationPipe(endpoints.supply.create.body))
    body: z.output<typeof CreateSupplyRecordSchema>,
  ) {
    return this.supply.create(body);
  }

  @RequirePermission('samakios.supply.manage', SAMAKIOS)
  @Endpoint(endpoints.supply.update)
  update(
    @Param(new ZodValidationPipe(endpoints.supply.update.params))
    params: { supplyRecordId: string },
    @Body(new ZodValidationPipe(endpoints.supply.update.body))
    body: z.output<typeof UpdateSupplyRecordSchema>,
  ) {
    return this.supply.update(params.supplyRecordId as Id, body);
  }
}

@Module({ controllers: [SupplyController], providers: [SupplyService] })
export class SupplyModule {}
