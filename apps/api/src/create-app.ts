import 'reflect-metadata';
import { newId } from '@blue/primitives';
import { RequestMethod, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { AppModule } from './app.module.js';
import type { AppConfig } from './kernel/config/app-config.js';
import { RequestContext, type RequestContextStore } from './kernel/context/request-context.js';

const REQUEST_ID_HEADER = 'x-request-id';
// Accept a caller's request ID (e.g. from the load balancer) only if it is short and plain.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;
const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB; file uploads go to object storage, not the API

/** Builds the configured application without listening, so tests use the real bootstrap. */
export async function createApp(
  config: AppConfig,
  extraModules: DynamicModule['imports'] = [],
): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: MAX_BODY_BYTES,
    // Only behind a trusted load balancer; otherwise clients could spoof X-Forwarded-For and
    // dodge per-IP rate limits.
    trustProxy: config.TRUST_PROXY,
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers[REQUEST_ID_HEADER];
      return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : newId();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, extraModules),
    adapter,
    // abortOnError: false — surface bootstrap failures as exceptions instead of process.abort().
    { bufferLogs: true, abortOnError: false },
  );
  app.useLogger(app.get(Logger));

  const fastify = app.getHttpAdapter().getInstance();
  // Declared up front (Fastify keeps request objects monomorphic); filled per request below.
  fastify.decorateRequest('blueContext', null as unknown as RequestContextStore);
  fastify.addHook('onRequest', async (request, reply) => {
    request.blueContext = RequestContext.create(request.id, request.ip);
    void reply.header(REQUEST_ID_HEADER, request.id);
  });

  // Credentialed CORS for the product web apps only (ARCHITECTURE.md §14). No origins
  // configured = no cross-origin browser access at all.
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'content-type',
      'x-requested-with',
      'idempotency-key',
      'if-match',
      'x-request-id',
    ],
    exposedHeaders: ['x-request-id', 'retry-after', 'idempotent-replayed', 'etag'],
    maxAge: 600,
  });

  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();
  return app;
}
