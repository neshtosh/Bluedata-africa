import {
  endpoints,
  type CreatePurchaseSchema,
  type ListBatchesQuerySchema,
  type ListPurchasesQuerySchema,
} from '@blue/contracts';
import type { Id } from '@blue/primitives';
import { Body, Controller, Inject, Module, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { ZodValidationPipe } from '../../kernel/validation/zod-validation.pipe.js';
import { RequirePermission } from '../../platform/access/access-policy.js';
import { InventoryService } from './inventory.service.js';
import { PurchasesService } from './purchases.service.js';

const SAMAKIOS = { product: 'samakios' } as const;

@Controller()
export class PurchasesController {
  constructor(@Inject(PurchasesService) private readonly purchases: PurchasesService) {}

  @RequirePermission('samakios.purchases.read', SAMAKIOS)
  @Endpoint(endpoints.purchases.list)
  list(
    @Query(new ZodValidationPipe(endpoints.purchases.list.query))
    query: z.output<typeof ListPurchasesQuerySchema>,
  ) {
    return this.purchases.list(query);
  }

  @RequirePermission('samakios.purchases.manage', SAMAKIOS)
  @Endpoint(endpoints.purchases.create)
  create(
    @Body(new ZodValidationPipe(endpoints.purchases.create.body))
    body: z.output<typeof CreatePurchaseSchema>,
  ) {
    return this.purchases.create(body);
  }

  @RequirePermission('samakios.purchases.manage', SAMAKIOS)
  @Endpoint(endpoints.purchases.confirm)
  confirm(
    @Param(new ZodValidationPipe(endpoints.purchases.confirm.params))
    params: { purchaseId: string },
    @Body(new ZodValidationPipe(endpoints.purchases.confirm.body)) body: { version: number },
  ) {
    return this.purchases.confirm(params.purchaseId as Id, body.version);
  }

  @RequirePermission('samakios.purchases.manage', SAMAKIOS)
  @Endpoint(endpoints.purchases.cancel)
  cancel(
    @Param(new ZodValidationPipe(endpoints.purchases.cancel.params))
    params: { purchaseId: string },
    @Body(new ZodValidationPipe(endpoints.purchases.cancel.body)) body: { version: number },
  ) {
    return this.purchases.cancel(params.purchaseId as Id, body.version);
  }
}

@Controller()
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @RequirePermission('samakios.inventory.read', SAMAKIOS)
  @Endpoint(endpoints.inventory.batches)
  batches(
    @Query(new ZodValidationPipe(endpoints.inventory.batches.query))
    query: z.output<typeof ListBatchesQuerySchema>,
  ) {
    return this.inventory.batches(query);
  }

  @RequirePermission('samakios.inventory.read', SAMAKIOS)
  @Endpoint(endpoints.inventory.summary)
  summary() {
    return this.inventory.summary();
  }
}

@Module({
  controllers: [PurchasesController, InventoryController],
  providers: [PurchasesService, InventoryService],
})
export class PurchasesModule {}
