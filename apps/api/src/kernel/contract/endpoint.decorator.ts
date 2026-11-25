import type { Endpoint as EndpointContract } from '@blue/contracts';
import {
  applyDecorators,
  HttpCode,
  RequestMapping,
  RequestMethod,
  SetMetadata,
} from '@nestjs/common';

export const ENDPOINT_METADATA = 'blue:endpoint';

/**
 * Mounts a route from its contract in @blue/contracts (ADR-016): method, path and success status
 * come from the contract, so the API cannot serve a path the contract doesn't describe.
 * Controllers use `@Controller()` with no prefix; the /v1 prefix is global.
 */
export function Endpoint(contract: EndpointContract) {
  return applyDecorators(
    RequestMapping({ path: contract.path, method: RequestMethod[contract.method] }),
    HttpCode(contract.status),
    SetMetadata(ENDPOINT_METADATA, contract),
  );
}
