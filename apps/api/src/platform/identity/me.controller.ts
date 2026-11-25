import { endpoints, type SetPassword } from '@blue/contracts';
import { userCredentials, users, type DatabaseHandle } from '@blue/database';
import type { Id } from '@blue/primitives';
import { Body, Controller, Inject, Param } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { RequestContext } from '../../kernel/context/request-context.js';
import { DATABASE } from '../../kernel/database/database.token.js';
import { AppError } from '../../kernel/errors/app-error.js';
import { ZodValidationPipe } from '../../kernel/validation/zod-validation.pipe.js';
import { SignedIn } from '../access/access-policy.js';
import { AuditService } from '../audit/audit.service.js';
import { TenancyService } from '../tenancy/tenancy.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';

@Controller()
@SignedIn()
export class MeController {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(TenancyService) private readonly tenancy: TenancyService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** The signed-in user, their organisations and invitations, and what they may do in each. */
  @Endpoint(endpoints.me.get)
  async me() {
    const userId = currentUser();
    const [user] = await this.database.db
      .select({
        id: users.id,
        displayName: users.displayName,
        phone: users.phoneE164,
        email: users.email,
        locale: users.locale,
        mfaEnabled: users.mfaEnabled,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw AppError.notFound();
    const [password] = await this.database.db
      .select({ id: userCredentials.id })
      .from(userCredentials)
      .where(and(eq(userCredentials.userId, userId), eq(userCredentials.type, 'password')));
    return {
      user: { ...user, hasPassword: Boolean(password) },
      organisations: await this.tenancy.listMine(userId),
    };
  }

  /** Sets or changes the password and signs out every other session. */
  @Endpoint(endpoints.me.setPassword)
  async setPassword(
    @Body(new ZodValidationPipe(endpoints.me.setPassword.body)) body: SetPassword,
  ): Promise<void> {
    const { userId, sessionId } = RequestContext.require();
    if (!userId) throw new Error('signed-in route without user');
    await this.passwords.set(userId, body.password);
    await this.sessions.revokeAllForUser(userId, sessionId ?? undefined);
    await this.audit.recordStandalone({
      action: 'user.password_changed',
      entityType: 'user',
      entityId: userId,
    });
  }

  @Endpoint(endpoints.me.acceptInvitation)
  accept(
    @Param(new ZodValidationPipe(endpoints.me.acceptInvitation.params))
    { orgId }: { orgId: string },
  ) {
    return this.tenancy.acceptInvitation(orgId as Id);
  }
}

function currentUser(): Id {
  const { userId } = RequestContext.require();
  if (!userId) throw new Error('signed-in route without user');
  return userId;
}
