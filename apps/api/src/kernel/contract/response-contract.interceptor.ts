import type { Endpoint } from '@blue/contracts';
import {
  Inject,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { ENDPOINT_METADATA } from './endpoint.decorator.js';

/**
 * Validates every response against its contract and returns the *parsed* value, so fields the
 * contract doesn't declare are stripped. This runs in every environment: it is an allowlist that
 * stops accidental leaks (e.g. a credential hash added to a query) from reaching clients.
 * A mismatch is a server bug — logged with details and answered with an opaque 500.
 */
@Injectable()
export class ResponseContractInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ResponseContractInterceptor.name);

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const endpoint = this.reflector.get<Endpoint | undefined>(
      ENDPOINT_METADATA,
      context.getHandler(),
    );
    const schema = endpoint?.response;
    if (!endpoint || !schema) return next.handle();
    return next.handle().pipe(
      map((body: unknown) => {
        const result = schema.safeParse(body);
        if (result.success) return result.data;
        // Issue paths only: values may contain personal data.
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        this.logger.error(
          { issues },
          `Response does not match contract ${endpoint.method} ${endpoint.path}`,
        );
        throw new Error(`Response contract violation for ${endpoint.method} ${endpoint.path}`);
      }),
    );
  }
}
