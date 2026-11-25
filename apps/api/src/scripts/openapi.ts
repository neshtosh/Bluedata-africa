// Regenerates or checks apps/api/openapi.json.
//   pnpm --filter @blue/api openapi:generate                    write; refuse breaking changes
//   pnpm --filter @blue/api openapi:generate --accept-breaking  write even if breaking
//   pnpm --filter @blue/api openapi:check                       fail if the file is out of date
import 'reflect-metadata';
import { detectBreakingChanges } from '../openapi/breaking-changes.js';
import { buildOpenApi } from '../openapi/build-openapi.js';
import { OPENAPI_FILE, readCommitted, serialize, writeCommitted } from '../openapi/openapi-file.js';

const args = new Set(process.argv.slice(2));
const generated = buildOpenApi();
const committed = readCommitted();
const breaking = committed ? detectBreakingChanges(committed, generated) : [];
const upToDate = committed !== undefined && serialize(committed) === serialize(generated);

if (breaking.length > 0) {
  process.stderr.write(
    `Breaking API changes compared with ${OPENAPI_FILE}:\n  - ${breaking.join('\n  - ')}\n`,
  );
}

if (args.has('--check')) {
  if (!upToDate) {
    process.stderr.write(
      'openapi.json is out of date. Run: pnpm --filter @blue/api openapi:generate\n',
    );
    process.exit(1);
  }
  process.stdout.write('openapi.json is up to date.\n');
} else if (upToDate) {
  process.stdout.write('openapi.json already up to date.\n');
} else if (breaking.length > 0 && !args.has('--accept-breaking')) {
  process.stderr.write(
    'Not written. If these changes are intended (and clients are migrated), rerun with --accept-breaking.\n',
  );
  process.exit(1);
} else {
  writeCommitted(generated);
  process.stdout.write(`Wrote ${OPENAPI_FILE}\n`);
}
