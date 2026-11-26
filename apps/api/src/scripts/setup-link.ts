// Operator tool (ADR-019): creates a one-time setup link for a person, creating their account
// if the phone number is new. Use it for the first owner of each pilot organisation, and for
// password resets (organisation owners can only create links for people who never signed in).
//
// Usage:
//   node dist/scripts/setup-link.js --phone +254712345678 --name "Achieng Otieno"
//   (development: pnpm --filter @blue/api setup-link -- --phone … --name …)
// Prints the link path (/setup#token=…). Put the app's address in front of it, e.g.
// https://<samakios-address>/setup#token=…, and send it to that person only.
import { PhoneE164 } from '@blue/contracts';
import { createDatabase, users } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { eq } from 'drizzle-orm';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { issueSetupToken, setupPath } from '../platform/identity/setup-tokens.js';

const env = z
  .object({
    DATABASE_RUNTIME_URL: z.string().min(1),
    AUTH_SECRET: z.string().min(32),
    SETUP_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(336).default(72),
  })
  .safeParse(process.env);
if (!env.success) {
  process.stderr.write(
    'DATABASE_RUNTIME_URL and AUTH_SECRET (the same values the API uses) are required.\n',
  );
  process.exit(1);
}

const { values } = parseArgs({
  options: { phone: { type: 'string' }, name: { type: 'string' }, base: { type: 'string' } },
});
const phone = PhoneE164.safeParse(values.phone);
if (!phone.success) {
  process.stderr.write('--phone must be in international form, e.g. +254712345678\n');
  process.exit(1);
}

const database = createDatabase(env.data.DATABASE_RUNTIME_URL, { maxConnections: 1 });
try {
  const [existing] = await database.db
    .select({ id: users.id, displayName: users.displayName, status: users.status })
    .from(users)
    .where(eq(users.phoneE164, phone.data));
  let userId = existing?.id as Id | undefined;
  if (existing && existing.status !== 'active') {
    process.stderr.write(`That account is ${existing.status}; no link was created.\n`);
    process.exitCode = 1;
  } else {
    if (!userId) {
      const name = values.name?.trim();
      if (!name) {
        process.stderr.write('New phone number: --name is required to create the account.\n');
        process.exit(1);
      }
      userId = newId();
      await database.db
        .insert(users)
        .values({ id: userId, displayName: name, phoneE164: phone.data });
    }
    const { token, expiresAt } = await issueSetupToken(
      database.db,
      env.data.AUTH_SECRET,
      env.data.SETUP_LINK_TTL_HOURS,
      { userId },
    );
    const path = setupPath(token);
    const base = values.base?.replace(/\/+$/, '');
    process.stdout.write(
      [
        `${existing ? 'Existing account' : 'New account'}: ${existing?.displayName ?? values.name}`,
        `Setup link (works once, until ${expiresAt.toISOString()}):`,
        base ? `${base}${path}` : `<app address>${path}`,
        '',
      ].join('\n'),
    );
  }
} finally {
  await database.close();
}
