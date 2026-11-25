import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type FieldError } from './app-error.js';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance: string;
  requestId: string;
  errors?: FieldError[];
}

const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// Stable per-code URI. Points at our error docs once the platform domain is chosen.
const problemType = (code: string) => `urn:blue:problem:${code.toLowerCase().replaceAll('_', '-')}`;

const STATUS_CODES: Record<number, { code: string; title: string }> = {
  400: { code: 'BAD_REQUEST', title: 'Bad request' },
  401: { code: 'UNAUTHENTICATED', title: 'Authentication required' },
  403: { code: 'FORBIDDEN', title: 'Not permitted' },
  404: { code: 'NOT_FOUND', title: 'Resource not found' },
  405: { code: 'METHOD_NOT_ALLOWED', title: 'Method not allowed' },
  409: { code: 'CONFLICT', title: 'Conflict' },
  412: { code: 'PRECONDITION_FAILED', title: 'Precondition failed' },
  413: { code: 'PAYLOAD_TOO_LARGE', title: 'Request body too large' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', title: 'Unsupported media type' },
  422: { code: 'UNPROCESSABLE', title: 'Request could not be processed' },
  429: { code: 'RATE_LIMITED', title: 'Too many requests' },
};

/**
 * Converts every error into RFC 9457 problem+json (API.md §1.1). Expected failures (AppError,
 * Nest/Fastify 4xx) keep their status and message; anything else is logged in full and
 * returned as an opaque 500, so stack traces, SQL and internals never reach clients.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const problem = this.toProblem(exception, request);
    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: request.id }, 'Unhandled error');
    }
    if (exception instanceof AppError && exception.headers) void reply.headers(exception.headers);
    void reply.status(problem.status).header('content-type', PROBLEM_CONTENT_TYPE).send(problem);
  }

  private toProblem(exception: unknown, request: FastifyRequest): ProblemDetails {
    const base = { instance: request.url.split('?')[0] ?? request.url, requestId: request.id };

    if (exception instanceof AppError) {
      return {
        type: problemType(exception.code),
        title: exception.title,
        status: exception.status,
        code: exception.code,
        ...(exception.detail === undefined ? {} : { detail: exception.detail }),
        ...(exception.errors === undefined ? {} : { errors: exception.errors }),
        ...base,
      };
    }

    const status = clientErrorStatus(exception);
    if (status !== undefined) {
      const known = STATUS_CODES[status] ?? { code: 'CLIENT_ERROR', title: 'Client error' };
      return {
        type: problemType(known.code),
        title: known.title,
        status,
        code: known.code,
        ...base,
      };
    }

    return {
      type: problemType('INTERNAL_ERROR'),
      title: 'Internal server error',
      status: 500,
      code: 'INTERNAL_ERROR',
      detail: 'An unexpected error occurred. Quote the requestId when contacting support.',
      ...base,
    };
  }
}

/** 4xx status from Nest HttpExceptions or Fastify errors (bad JSON, body too large, …). */
function clientErrorStatus(exception: unknown): number | undefined {
  const status =
    exception instanceof HttpException
      ? exception.getStatus()
      : typeof exception === 'object' && exception !== null && 'statusCode' in exception
        ? Number(exception.statusCode)
        : undefined;
  return status !== undefined && status >= 400 && status < 500 ? status : undefined;
}
