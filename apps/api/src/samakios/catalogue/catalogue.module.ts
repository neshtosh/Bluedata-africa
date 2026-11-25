import {
  endpoints,
  type CreateCatalogueItemSchema,
  type UpdateCatalogueItemSchema,
} from '@blue/contracts';
import type { Id } from '@blue/primitives';
import { Body, Controller, Inject, Module, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { ZodValidationPipe } from '../../kernel/validation/zod-validation.pipe.js';
import { RequirePermission } from '../../platform/access/access-policy.js';
import { CatalogueService } from './catalogue.service.js';

const SAMAKIOS = { product: 'samakios' } as const;

@Controller()
export class CatalogueController {
  constructor(@Inject(CatalogueService) private readonly catalogue: CatalogueService) {}

  @RequirePermission('samakios.catalogue.read', SAMAKIOS)
  @Endpoint(endpoints.catalogue.list)
  list(
    @Query(new ZodValidationPipe(endpoints.catalogue.list.query))
    query: {
      includeArchived?: boolean;
    },
  ) {
    return this.catalogue.list(query.includeArchived ?? false);
  }

  @RequirePermission('samakios.catalogue.manage', SAMAKIOS)
  @Endpoint(endpoints.catalogue.create)
  create(
    @Body(new ZodValidationPipe(endpoints.catalogue.create.body))
    body: z.output<typeof CreateCatalogueItemSchema>,
  ) {
    return this.catalogue.create(body);
  }

  @RequirePermission('samakios.catalogue.manage', SAMAKIOS)
  @Endpoint(endpoints.catalogue.update)
  update(
    @Param(new ZodValidationPipe(endpoints.catalogue.update.params)) params: { itemId: string },
    @Body(new ZodValidationPipe(endpoints.catalogue.update.body))
    body: z.output<typeof UpdateCatalogueItemSchema>,
  ) {
    return this.catalogue.update(params.itemId as Id, body);
  }
}

@Module({ controllers: [CatalogueController], providers: [CatalogueService] })
export class CatalogueModule {}
