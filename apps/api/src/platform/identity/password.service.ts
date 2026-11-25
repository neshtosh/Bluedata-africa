import { userCredentials, users, type DatabaseHandle } from '@blue/database';
import { newId, type Id } from '@blue/primitives';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE } from '../../kernel/database/database.token.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './crypto.js';

/** Optional password sign-in, alongside phone OTP (ADR-007). */
@Injectable()
export class PasswordService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseHandle) {}

  async verify(phone: string, password: string): Promise<Id> {
    const [row] = await this.database.db
      .select({ userId: users.id, status: users.status, secretHash: userCredentials.secretHash })
      .from(users)
      .leftJoin(
        userCredentials,
        and(eq(userCredentials.userId, users.id), eq(userCredentials.type, 'password')),
      )
      .where(eq(users.phoneE164, phone));

    // Always run Argon2, even for unknown numbers, so response time doesn't reveal accounts.
    const valid = await verifyPassword(row?.secretHash ?? DUMMY_PASSWORD_HASH, password);
    if (!row || !row.secretHash || !valid) {
      throw new AppError({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        title: 'Invalid phone number or password',
      });
    }
    if (row.status !== 'active') {
      throw new AppError({ status: 403, code: 'ACCOUNT_SUSPENDED', title: 'Account suspended' });
    }
    await this.database.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, row.userId));
    return row.userId as Id;
  }

  async set(userId: Id, password: string): Promise<void> {
    const secretHash = await hashPassword(password);
    await this.database.db.transaction(async (tx) => {
      await tx
        .delete(userCredentials)
        .where(and(eq(userCredentials.userId, userId), eq(userCredentials.type, 'password')));
      await tx
        .insert(userCredentials)
        .values({ id: newId(), userId, type: 'password', secretHash });
    });
  }
}
