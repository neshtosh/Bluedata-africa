// Deployment job: apply migrations, then upsert reference data. Runs as app_migrator, before
// new API/worker versions start (`node dist/scripts/migrate.js` in the API image).
import { createDatabase, runMigrations, seedReferenceData } from '@blue/database';

const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) {
  process.stderr.write('DATABASE_MIGRATOR_URL is required\n');
  process.exit(1);
}

await runMigrations(url);
const { db, close } = createDatabase(url, { maxConnections: 1 });
try {
  await seedReferenceData(db);
} finally {
  await close();
}
process.stdout.write('Migrations applied and reference data seeded.\n');
