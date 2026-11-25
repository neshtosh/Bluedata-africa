import 'reflect-metadata';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from './kernel/config/app-config.js';
import { WorkerModule } from './worker/worker.module.js';

/** Builds the worker application context (no HTTP), so tests use the real bootstrap. */
export async function createWorker(config: AppConfig): Promise<INestApplicationContext> {
  const worker = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
    bufferLogs: true,
    abortOnError: false,
  });
  worker.useLogger(worker.get(Logger));
  worker.enableShutdownHooks();
  return worker;
}
