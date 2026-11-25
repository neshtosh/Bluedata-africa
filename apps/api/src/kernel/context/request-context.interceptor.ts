import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { RequestContext } from './request-context.js';

/** Runs each HTTP handler inside the request's context store (see request-context.ts). */
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    return new Observable((subscriber) =>
      RequestContext.run(request.blueContext, () => next.handle().subscribe(subscriber)),
    );
  }
}
