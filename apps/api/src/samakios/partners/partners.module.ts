import {
  endpoints,
  type CreateTradingPartnerSchema,
  type ListTradingPartnersQuerySchema,
  type UpdateTradingPartnerSchema,
} from '@blue/contracts';
import type { Id } from '@blue/primitives';
import { Body, Controller, Inject, Module, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { ZodValidationPipe } from '../../kernel/validation/zod-validation.pipe.js';
import { RequirePermission } from '../../platform/access/access-policy.js';
import { PartnersService } from './partners.service.js';

const SAMAKIOS = { product: 'samakios' } as const;

@Controller()
export class PartnersController {
  constructor(@Inject(PartnersService) private readonly partners: PartnersService) {}

  @RequirePermission('samakios.partners.read', SAMAKIOS)
  @Endpoint(endpoints.partners.list)
  list(
    @Query(new ZodValidationPipe(endpoints.partners.list.query))
    query: z.output<typeof ListTradingPartnersQuerySchema>,
  ) {
    return this.partners.list(query);
  }

  @RequirePermission('samakios.partners.manage', SAMAKIOS)
  @Endpoint(endpoints.partners.create)
  create(
    @Body(new ZodValidationPipe(endpoints.partners.create.body))
    body: z.output<typeof CreateTradingPartnerSchema>,
  ) {
    return this.partners.create(body);
  }

  @RequirePermission('samakios.partners.manage', SAMAKIOS)
  @Endpoint(endpoints.partners.update)
  update(
    @Param(new ZodValidationPipe(endpoints.partners.update.params)) params: { partnerId: string },
    @Body(new ZodValidationPipe(endpoints.partners.update.body))
    body: z.output<typeof UpdateTradingPartnerSchema>,
  ) {
    return this.partners.update(params.partnerId as Id, body);
  }
}

@Module({ controllers: [PartnersController], providers: [PartnersService] })
export class PartnersModule {}
