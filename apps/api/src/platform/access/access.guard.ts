import { isId } from '@blue/primitives';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../kernel/errors/app-error.js';
import { readSessionCookie } from '../identity/session-cookie.js';
import { SessionService } from '../identity/session.service.js';
import { TenancyService, type OrganisationAccess } from '../tenancy/tenancy.service.js';
import { ACCESS_POLICY, type AccessPolicy } from './access-policy.js';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

declare module 'fastify' {
  interface FastifyRequest {
    blueAccess?: OrganisationAccess;
  }
}

/**
 * The single authorisation gate (ARCHITECTURE.md §8.2), run before every handler:
 *   CSRF header → session → (org membership → product entitlement → permission).
 * It fills the request context, so TenantDatabase and RLS apply to the right organisation.
 * Non-members get 404, not 403, so other organisations' existence is never revealed.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(TenancyService) private readonly tenancy: TenancyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!policy) {
      // Fail closed: a route without a declared policy is a programming error.
      throw new Error(
        `No access policy declared for ${request.method} ${request.routeOptions.url}`,
      );
    }

    // CSRF (ARCHITECTURE.md §14): browsers can't add custom headers to cross-site form posts,
    // and CORS rejects cross-origin scripts that try. Applies to sign-in endpoints too.
    if (STATE_CHANGING.has(request.method) && !request.headers['x-requested-with']) {
      throw new AppError({
        status: 403,
        code: 'CSRF_HEADER_MISSING',
        title: 'Missing X-Requested-With header',
        detail: 'State-changing requests must include an X-Requested-With header.',
      });
    }
    if (policy.kind === 'public') return true;

    const token = readSessionCookie(request);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) {
      throw new AppError({ status: 401, code: 'UNAUTHENTICATED', title: 'Sign-in required' });
    }
    const store = request.blueContext;
    store.userId = session.userId;
    store.sessionId = session.sessionId;
    if (policy.kind === 'signed_in') return true;

    const orgId = (request.params as Record<string, string | undefined> | undefined)?.orgId;
    if (orgId === undefined) {
      throw new Error(`Permission policy on a route without :orgId (${request.routeOptions.url})`);
    }
    // A malformed ID is just another organisation the caller can't see: 404.
    if (!isId(orgId)) throw AppError.notFound();
    const access = await this.tenancy.loadAccess(session.userId, orgId);
    if (!access) throw AppError.notFound();
    if (policy.product && !access.products.has(policy.product)) {
      throw new AppError({
        status: 403,
        code: 'PRODUCT_NOT_ENTITLED',
        title: 'Product not included in subscription',
        detail: `This organisation's subscription does not include ${policy.product}.`,
      });
    }
    if (!access.permissions.has(policy.permission)) {
      throw new AppError({
        status: 403,
        code: 'FORBIDDEN',
        title: 'Not permitted',
        detail: `Requires the ${policy.permission} permission.`,
      });
    }
    store.organisationId = orgId;
    request.blueAccess = access;
    return true;
  }
}
