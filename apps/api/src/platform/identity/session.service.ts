import { sessions, users, type DatabaseHandle } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../../kernel/config/app-config.js';
import { DATABASE } from '../../kernel/database/database.token.js';
import { hashSessionToken, newSessionToken } from './crypto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Avoid a write on every request: last_seen_at is refreshed at most this often. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface ResolvedSession {
  sessionId: Id;
  userId: Id;
}

/**
 * Opaque server-side sessions (ARCHITECTURE.md §10.1). The client holds a random 256-bit token;
 * the database holds only its SHA-256, so a database leak doesn't expose usable sessions, and
 * revocation takes effect on the very next request. Identity tables are global (no RLS).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(
    userId: Id,
    client: { ip: string | null; userAgent: string | null },
  ): Promise<{ sessionId: Id; token: string; expiresAt: Date }> {
    const { token, tokenHash } = newSessionToken();
    const sessionId = newId();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_DAYS * DAY_MS);
    await this.database.db.insert(sessions).values({
      id: sessionId,
      userId,
      tokenHash,
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 500) ?? null,
      expiresAt,
    });
    return { sessionId, token, expiresAt };
  }

  /** The session for a token, if it is live and its user is active; otherwise null. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const now = new Date();
    const [row] = await this.database.db
      .select({ sessionId: sessions.id, userId: sessions.userId, lastSeenAt: sessions.lastSeenAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashSessionToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          eq(users.status, 'active'),
        ),
      )
      .limit(1);
    if (!row) return null;

    if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.database.db
        .update(sessions)
        .set({ lastSeenAt: now })
        .where(eq(sessions.id, row.sessionId));
    }
    return { sessionId: row.sessionId as Id, userId: row.userId as Id };
  }

  async revoke(sessionId: Id): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  /** Revokes all of a user's sessions except (optionally) the current one — e.g. on password change. */
  async revokeAllForUser(userId: Id, exceptSessionId?: Id): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          exceptSessionId ? sql`${sessions.id} <> ${exceptSessionId}` : undefined,
        ),
      );
  }

  /** Housekeeping for the worker: drop sessions that expired more than a week ago. */
  async purgeExpired(): Promise<void> {
    await this.database.db
      .delete(sessions)
      .where(lt(sessions.expiresAt, new Date(Date.now() - 7 * DAY_MS)));
  }
}
