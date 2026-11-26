// One-time setup links (ADR-019). Shared by the API (organisation owners) and the operator's
// command-line script, so both issue tokens the same way.
import { setupTokens, type Database, type Transaction } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { and, eq, isNull } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { hmac } from './crypto.js';

/** HMAC under the server secret: a database leak alone doesn't reveal working links. */
export function hashSetupToken(secret: string, token: string): Buffer {
  return hmac(secret, 'setup-link', token);
}

/** The relative link a person opens. The token is in the #fragment, so it never reaches logs. */
export function setupPath(token: string): string {
  return `/setup#token=${token}`;
}

/**
 * Issues a new setup token for a user, replacing any earlier unused one (only the latest link
 * works). Returns the plaintext token, which is shown once and never stored.
 */
export async function issueSetupToken(
  db: Database | Transaction,
  secret: string,
  ttlHours: number,
  input: { userId: Id; organisationId?: Id | null; createdByUserId?: Id | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url'); // 43 characters
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600 * 1000);
  await db
    .update(setupTokens)
    .set({ consumedAt: now })
    .where(and(eq(setupTokens.userId, input.userId), isNull(setupTokens.consumedAt)));
  await db.insert(setupTokens).values({
    id: newId(),
    userId: input.userId,
    tokenHash: hashSetupToken(secret, token),
    organisationId: input.organisationId ?? null,
    createdByUserId: input.createdByUserId ?? null,
    expiresAt,
  });
  return { token, expiresAt };
}
