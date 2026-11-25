import { Module } from '@nestjs/common';
import { OrganisationsController } from './organisations.controller.js';
import { TenancyService } from './tenancy.service.js';

@Module({
  controllers: [OrganisationsController],
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
