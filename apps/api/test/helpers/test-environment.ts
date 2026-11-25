import { startTestDatabase, type TestDatabase } from '@blue/database/testing';
import type { DynamicModule } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createApp } from '../../src/create-app.js';
import { loadConfig, type AppConfig } from '../../src/kernel/config/app-config.js';

/** Real PostGIS (as app_runtime) + real Valkey, in throwaway containers. */
export interface TestEnvironment {
  database: TestDatabase;
  valkey: StartedTestContainer;
  config: AppConfig;
  stop: () => Promise<void>;
}

export async function startTestEnvironment(): Promise<TestEnvironment> {
  const [database, valkey] = await Promise.all([
    startTestDatabase(),
    new GenericContainer('valkey/valkey:8.1')
      .withExposedPorts(6379)
      .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
      .start(),
  ]);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_RUNTIME_URL: database.runtimeUrl,
    VALKEY_URL: `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`,
    OUTBOX_POLL_INTERVAL_MS: '100',
    AUTH_SECRET: 'integration-test-secret-0123456789abcdef',
  });
  return {
    database,
    valkey,
    config,
    stop: async () => {
      await Promise.all([database.stop(), valkey.stop()]);
    },
  };
}

/** The real application (same bootstrap as production), ready for `app.inject()`. */
export async function startApp(
  config: AppConfig,
  extraModules: DynamicModule['imports'] = [],
): Promise<NestFastifyApplication> {
  const app = await createApp(config, extraModules);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
