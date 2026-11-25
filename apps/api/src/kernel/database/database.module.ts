import { createDatabase, type DatabaseHandle } from '@blue/database';
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE } from './database.token.js';
import { TenantDatabase } from './tenant-database.js';

export { DATABASE } from './database.token.js';

@Injectable()
class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createDatabase(config.DATABASE_RUNTIME_URL, { maxConnections: config.DATABASE_POOL_SIZE }),
    },
    DatabaseShutdown,
    TenantDatabase,
  ],
  exports: [DATABASE, TenantDatabase],
})
export class DatabaseModule {}
