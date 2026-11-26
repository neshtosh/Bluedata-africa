import { endpoints, type CreateOrganisation, type InviteMember } from '@blue/contracts';
import type { Id } from '@blue/primitives';
import { Body, Controller, Inject, Param } from '@nestjs/common';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { ZodValidationPipe } from '../../kernel/validation/zod-validation.pipe.js';
import { RequirePermission, SignedIn } from '../access/access-policy.js';
import { TenancyService } from './tenancy.service.js';

/**
 * `:orgId` routes are authorised by the AccessGuard (membership + permission) before the handler
 * runs, and execute inside that organisation's tenant context — handlers never take orgId as an
 * argument, so they cannot accidentally act on a different organisation.
 */
@Controller()
export class OrganisationsController {
  constructor(@Inject(TenancyService) private readonly tenancy: TenancyService) {}

  @SignedIn()
  @Endpoint(endpoints.orgs.register)
  register(@Body(new ZodValidationPipe(endpoints.orgs.register.body)) body: CreateOrganisation) {
    return this.tenancy.register(body);
  }

  @RequirePermission('platform.org.read')
  @Endpoint(endpoints.orgs.get)
  get() {
    return this.tenancy.current();
  }

  @RequirePermission('platform.members.read')
  @Endpoint(endpoints.orgs.listMembers)
  members() {
    return this.tenancy.listMembers();
  }

  @RequirePermission('platform.members.invite')
  @Endpoint(endpoints.orgs.invite)
  invite(@Body(new ZodValidationPipe(endpoints.orgs.invite.body)) body: InviteMember) {
    return this.tenancy.invite(body);
  }

  @RequirePermission('platform.members.manage')
  @Endpoint(endpoints.orgs.createSetupLink)
  createSetupLink(
    @Param(new ZodValidationPipe(endpoints.orgs.createSetupLink.params)) params: { userId: string },
  ) {
    return this.tenancy.createSetupLink(params.userId as Id);
  }
}
