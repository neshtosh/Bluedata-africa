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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { catchError, from, map, of, switchMap, throwError, type Observable } from 'rxjs';
import { ENDPOINT_METADATA } from '../contract/endpoint.decorator.js';
import { AppError } from '../errors/app-error.js';
import { IdempotencyStore } from './idempotency.store.js';

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * Requires an Idempotency-Key where the endpoint contract says so (signed-in POSTs) and replays
 * the stored response for a repeated key (API.md §1) — essential for offline devices that resend
 * queued writes.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(IdempotencyStore) private readonly store: IdempotencyStore,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const endpoint = this.reflector.get<Endpoint | undefined>(
      ENDPOINT_METADATA,
      context.getHandler(),
    );
    if (endpoint?.idempotencyKey !== 'required') return next.handle();

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new AppError({
        status: 400,
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        title: 'Idempotency-Key header required',
        detail: 'Send a unique Idempotency-Key (8–128 characters, e.g. a UUID) with this request.',
      });
    }
    const requestHash = createHash('sha256')
      .update(`${request.method} ${request.url}\n${JSON.stringify(request.body ?? null)}`)
      .digest();
    const reply = context.switchToHttp().getResponse<FastifyReply>();

    return from(this.store.reserve(key, requestHash)).pipe(
      switchMap((reservation) => {
        if (reservation.kind === 'replay') {
          void reply.status(reservation.status).header('idempotent-replayed', 'true');
          return of(reservation.body);
        }
        return next.handle().pipe(
          // Store before responding, so an immediate retry replays instead of seeing
          // "in progress". The work already committed, so a storage failure must not turn
          // this response into an error; it is logged and the key expires as abandoned.
          switchMap((body: unknown) =>
            from(
              this.store.complete(reservation.id, endpoint.status, body).catch((error: unknown) => {
                this.logger.error({ err: error }, 'Failed to store idempotent response');
              }),
            ).pipe(map(() => body)),
          ),
          catchError((error: unknown) =>
            from(this.store.release(reservation.id)).pipe(switchMap(() => throwError(() => error))),
          ),
        );
      }),
    );
  }
}
