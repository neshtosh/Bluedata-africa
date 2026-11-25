import { endpoints } from '@blue/contracts';
import { Controller, Global, Inject, Module } from '@nestjs/common';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { SignedIn } from '../access/access-policy.js';
import { ReferenceService } from './reference.service.js';

@Controller()
@SignedIn()
export class ReferenceController {
  constructor(@Inject(ReferenceService) private readonly reference: ReferenceService) {}

  @Endpoint(endpoints.ref.vocabulary)
  vocabulary() {
    return this.reference.vocabulary();
  }
}

@Global()
@Module({
  controllers: [ReferenceController],
  providers: [ReferenceService],
  exports: [ReferenceService],
})
export class ReferenceModule {}
