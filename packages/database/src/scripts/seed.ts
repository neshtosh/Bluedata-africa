import { createDatabase } from '../client.js';
import { seedReferenceData } from '../seeds/reference-data.js';
import { requireEnv } from './env.js';

// Reference data is written as app_migrator: app_runtime has read-only access to ref.*.
const { db, close } = createDatabase(requireEnv('DATABASE_MIGRATOR_URL'), { maxConnections: 1 });
try {
  await seedReferenceData(db);
  process.stdout.write('Reference data seeded.\n');
} finally {
  await close();
}
