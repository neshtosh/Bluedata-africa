import { OTP_LENGTH, type OtpVerify } from '@blue/contracts';
import { otpChallenges, users, type DatabaseHandle } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../../kernel/config/app-config.js';
import { DATABASE } from '../../kernel/database/database.token.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { generateOtp, hmac, safeEqual } from './crypto.js';
import { SMS_SENDER, type SmsSender } from './sms-sender.js';

type VerifyOutcome =
  | { kind: 'ok'; userId: Id; isNewUser: boolean }
  | { kind: 'invalid' }
  | { kind: 'display_name_required' }
  | { kind: 'suspended' };

/** Same response for every failure, so callers can't tell which part was wrong. */
const invalidCode = () =>
  new AppError({
    status: 400,
    code: 'OTP_INVALID',
    title: 'Invalid or expired code',
    detail: 'Request a new code and try again.',
  });

/**
 * Phone one-time-code sign-in (ARCHITECTURE.md §10.2). Codes and destinations are stored only as
 * HMACs under AUTH_SECRET. The SMS is sent directly after the challenge commits — not via the
 * outbox — because the outbox would have to persist the plaintext code.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async request(phone: string): Promise<{ challengeId: Id; expiresAt: Date }> {
    const challengeId = newId();
    const code = generateOtp(OTP_LENGTH);
    const expiresAt = new Date(Date.now() + this.config.OTP_TTL_SECONDS * 1000);
    await this.database.db.insert(otpChallenges).values({
      id: challengeId,
      channel: 'sms',
      destinationHash: this.destinationHash(phone),
      codeHash: this.codeHash(challengeId, code),
      purpose: 'login',
      expiresAt,
    });
    const minutes = Math.round(this.config.OTP_TTL_SECONDS / 60);
    await this.sms.send(
      phone,
      `Your sign-in code is ${code}. It expires in ${minutes} minutes. Never share it.`,
    );
    // Identical response whether or not an account exists for this number (no enumeration).
    return { challengeId, expiresAt };
  }

  /** Verifies the code and returns the (possibly newly created) user. */
  async verify(input: OtpVerify): Promise<{ userId: Id; isNewUser: boolean }> {
    const outcome = await this.database.db.transaction(async (tx): Promise<VerifyOutcome> => {
      // Row lock: two concurrent verifications of one challenge cannot both succeed.
      const [challenge] = await tx
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.id, input.challengeId))
        .for('update');
      if (
        !challenge ||
        challenge.consumedAt !== null ||
        challenge.expiresAt <= new Date() ||
        challenge.attempts >= this.config.OTP_MAX_ATTEMPTS
      ) {
        return { kind: 'invalid' };
      }

      const matches =
        safeEqual(challenge.destinationHash, this.destinationHash(input.phone)) &&
        safeEqual(challenge.codeHash, this.codeHash(challenge.id, input.code));
      if (!matches) {
        // Returned (not thrown) so the attempt counter commits.
        await tx
          .update(otpChallenges)
          .set({ attempts: sql`${otpChallenges.attempts} + 1` })
          .where(eq(otpChallenges.id, challenge.id));
        return { kind: 'invalid' };
      }

      let [user] = await tx.select().from(users).where(eq(users.phoneE164, input.phone));
      const isNewUser = !user;
      if (!user) {
        // Code stays unconsumed, so the client can resubmit it with a display name.
        if (!input.displayName) return { kind: 'display_name_required' };
        [user] = await tx
          .insert(users)
          .values({ id: newId(), displayName: input.displayName, phoneE164: input.phone })
          .returning();
      }
      if (!user) throw new Error('user insert returned no row');
      if (user.status !== 'active') return { kind: 'suspended' };

      const now = new Date();
      await tx
        .update(otpChallenges)
        .set({ consumedAt: now })
        .where(eq(otpChallenges.id, challenge.id));
      await tx
        .update(users)
        .set({ phoneVerifiedAt: user.phoneVerifiedAt ?? now, lastLoginAt: now })
        .where(eq(users.id, user.id));
      return { kind: 'ok', userId: user.id as Id, isNewUser };
    });

    switch (outcome.kind) {
      case 'ok':
        return { userId: outcome.userId, isNewUser: outcome.isNewUser };
      case 'display_name_required':
        throw new AppError({
          status: 422,
          code: 'DISPLAY_NAME_REQUIRED',
          title: 'Display name required',
          detail: 'This number has no account yet. Resubmit the same code with a displayName.',
        });
      case 'suspended':
        throw new AppError({ status: 403, code: 'ACCOUNT_SUSPENDED', title: 'Account suspended' });
      case 'invalid':
        throw invalidCode();
    }
  }

  private destinationHash(phone: string): Buffer {
    return hmac(this.config.AUTH_SECRET, 'otp-destination', phone);
  }

  private codeHash(challengeId: string, code: string): Buffer {
    return hmac(this.config.AUTH_SECRET, 'otp-code', challengeId, code);
  }
}
