import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from './kernel/config/app-config.js';
import { ConfigModule } from './kernel/config/config.module.js';
import { ResponseContractInterceptor } from './kernel/contract/response-contract.interceptor.js';
import { RequestContextInterceptor } from './kernel/context/request-context.interceptor.js';
import { DatabaseModule } from './kernel/database/database.module.js';
import { ProblemDetailsFilter } from './kernel/errors/problem-details.filter.js';
import { IdempotencyInterceptor } from './kernel/idempotency/idempotency.interceptor.js';
import { IdempotencyModule } from './kernel/idempotency/idempotency.module.js';
import { buildLoggerParams } from './kernel/logging/logger-options.js';
import { OutboxModule } from './kernel/outbox/outbox.module.js';
import { QueueModule } from './kernel/queue/queue.module.js';
import { RateLimitModule } from './kernel/rate-limit/rate-limiter.js';
import { ValkeyModule } from './kernel/valkey/valkey.module.js';
import { OpenApiModule } from './openapi/openapi.controller.js';
import { AccessGuard } from './platform/access/access.guard.js';
import { AuditModule } from './platform/audit/audit.service.js';
import { HealthModule } from './platform/health/health.controller.js';
import { IdentityModule } from './platform/identity/identity.module.js';
import { ReferenceModule } from './platform/reference/reference.module.js';
import { TenancyModule } from './platform/tenancy/tenancy.module.js';
import { CatalogueModule } from './samakios/catalogue/catalogue.module.js';
import { PartnersModule } from './samakios/partners/partners.module.js';
import { SupplyModule } from './samakios/supply/supply.module.js';

/**
 * Root of the API process. Module groups (platform, samakios, bluedata) are added here as they
 * are built; SamakiOS and BlueData modules must never import each other (ARCHITECTURE.md §4.3).
 * `extraModules` lets tests mount test-only controllers on the real application.
 *
 * Request pipeline: AccessGuard (CSRF, session, tenant, permission) → RequestContextInterceptor
 * (runs the handler inside the request context) → IdempotencyInterceptor (replays) →
 * ResponseContractInterceptor (validates and strips the response) → handler.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig, extraModules: DynamicModule['imports'] = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot(buildLoggerParams(config)),
        DatabaseModule,
        ValkeyModule,
        QueueModule,
        OutboxModule,
        RateLimitModule,
        IdempotencyModule,
        AuditModule,
        HealthModule,
        IdentityModule,
        TenancyModule,
        ReferenceModule,
        // SamakiOS modules (must never import BlueData modules).
        CatalogueModule,
        PartnersModule,
        SupplyModule,
        // The API description is public knowledge for partners, but production doesn't serve it.
        ...(config.NODE_ENV === 'production' ? [] : [OpenApiModule]),
        ...extraModules,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_GUARD, useClass: AccessGuard },
        // Interceptors run in registration order: context first, so idempotency runs inside it.
        { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ResponseContractInterceptor },
      ],
    };
  }
}
