import type { PermissionKey } from '@blue/contracts';
import { SetMetadata } from '@nestjs/common';

export type ProductCode = 'samakios' | 'bluedata';

/**
 * Every route declares exactly one access policy; a route without one is refused by the
 * AccessGuard (fail closed) and flagged by the route-policy test. This is the "every endpoint
 * declares its permission" rule from API.md §1.2.
 */
export type AccessPolicy =
  | { kind: 'public' }
  | { kind: 'signed_in' }
  | { kind: 'permission'; permission: PermissionKey; product?: ProductCode };

export const ACCESS_POLICY = 'blue:access-policy';

/** No authentication: health checks, sign-in endpoints. */
export const Public = () => SetMetadata(ACCESS_POLICY, { kind: 'public' } satisfies AccessPolicy);

/** Any signed-in user, no organisation required: /me, registering an organisation. */
export const SignedIn = () =>
  SetMetadata(ACCESS_POLICY, { kind: 'signed_in' } satisfies AccessPolicy);

/**
 * Signed-in, an active member of the organisation in the `:orgId` route parameter, holding
 * `permission` there — and, if `product` is given, the organisation is entitled to that product.
 */
export const RequirePermission = (
  permission: PermissionKey,
  options: { product?: ProductCode } = {},
) =>
  SetMetadata(ACCESS_POLICY, {
    kind: 'permission',
    permission,
    ...(options.product === undefined ? {} : { product: options.product }),
  } satisfies AccessPolicy);
