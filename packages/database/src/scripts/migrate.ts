import { runMigrations } from '../migrate.js';
import { requireEnv } from './env.js';

await runMigrations(requireEnv('DATABASE_MIGRATOR_URL'));
process.stdout.write('Migrations applied.\n');
