import type { SetupLinkDetails } from '@blue/contracts';
import {
  organisations,
  setupTokens,
  userCredentials,
  users,
  withUserContext,
  type DatabaseHandle,
} from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../../kernel/config/app-config.js';
import { DATABASE } from '../../kernel/database/database.token.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { hashPassword } from './crypto.js';
import { hashSetupToken, issueSetupToken } from './setup-tokens.js';
import { maskPhone } from './sms-sender.js';

const invalid = () =>
  new AppError({
    status: 404,
    code: 'SETUP_LINK_INVALID',
    title: 'This setup link no longer works',
    detail: 'It may have been used already or expired. Ask the person who sent it for a new one.',
  });

/**
 * Setup links (ADR-019): with SMS switched off, people get an account (or a new password) by
 * opening a one-time link and choosing a password. Possession of the link is the proof, so
 * links are single-use, short-lived, replaced when re-issued, and stored only as HMACs.
 */
@Injectable()
export class SetupLinkService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  issue(input: { userId: Id; organisationId?: Id; createdByUserId?: Id }) {
    return issueSetupToken(
      this.database.db,
      this.config.AUTH_SECRET,
      this.config.SETUP_LINK_TTL_HOURS,
      input,
    );
  }

  async inspect(token: string): Promise<SetupLinkDetails> {
    const row = await this.find(token);
    let organisationName: string | null = null;
    if (row.organisationId) {
      const organisationId = row.organisationId;
      // Organisations are tenant data: readable here only as the invited user (RLS policy).
      const [organisation] = await withUserContext(this.database.db, row.userId as Id, (tx) =>
        tx
          .select({ legalName: organisations.legalName, tradingName: organisations.tradingName })
          .from(organisations)
          .where(eq(organisations.id, organisationId)),
      );
      organisationName = organisation ? (organisation.tradingName ?? organisation.legalName) : null;
    }
    return {
      phone: row.phone ? maskPhone(row.phone) : '—',
      displayName: row.displayName,
      organisationName,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * Consumes the link and sets the password (and name, if given) in one transaction. The caller
   * signs the user in and signs out their other sessions.
   */
  async complete(
    token: string,
    password: string,
    displayName: string | undefined,
  ): Promise<{ userId: Id; organisationId: Id | null }> {
    // Hash first (slow, CPU-bound) so the transaction stays short.
    const secretHash = await hashPassword(password);
    const tokenHash = hashSetupToken(this.config.AUTH_SECRET, token);
    return this.database.db.transaction(async (tx) => {
      // Consuming with a guarded UPDATE makes a double submit (or a race) succeed only once.
      const [consumed] = await tx
        .update(setupTokens)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(setupTokens.tokenHash, tokenHash),
            isNull(setupTokens.consumedAt),
            gt(setupTokens.expiresAt, new Date()),
          ),
        )
        .returning({ userId: setupTokens.userId, organisationId: setupTokens.organisationId });
      if (!consumed) throw invalid();
      const [user] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, consumed.userId));
      if (user?.status !== 'active') throw invalid();

      await tx
        .delete(userCredentials)
        .where(
          and(eq(userCredentials.userId, consumed.userId), eq(userCredentials.type, 'password')),
        );
      await tx
        .insert(userCredentials)
        .values({ id: newId(), userId: consumed.userId, type: 'password', secretHash });
      await tx
        .update(users)
        .set({ lastLoginAt: new Date(), ...(displayName ? { displayName } : {}) })
        .where(eq(users.id, consumed.userId));
      return {
        userId: consumed.userId as Id,
        organisationId: (consumed.organisationId as Id | null) ?? null,
      };
    });
  }

  private async find(token: string) {
    const [row] = await this.database.db
      .select({
        userId: setupTokens.userId,
        organisationId: setupTokens.organisationId,
        expiresAt: setupTokens.expiresAt,
        displayName: users.displayName,
        phone: users.phoneE164,
        status: users.status,
      })
      .from(setupTokens)
      .innerJoin(users, eq(users.id, setupTokens.userId))
      .where(
        and(
          eq(setupTokens.tokenHash, hashSetupToken(this.config.AUTH_SECRET, token)),
          isNull(setupTokens.consumedAt),
          gt(setupTokens.expiresAt, new Date()),
        ),
      );
    if (!row || row.status !== 'active') throw invalid();
    return row;
  }
}
