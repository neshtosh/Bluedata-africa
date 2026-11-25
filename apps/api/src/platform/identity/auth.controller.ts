import { endpoints, type OtpRequest, type OtpVerify, type PasswordLogin } from '@blue/contracts';
import { users, type DatabaseHandle } from '@blue/database';
import type { Id } from '@blue/primitives';
import { Body, Controller, Inject, Req, Res } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../../kernel/config/app-config.js';
import { RequestContext } from '../../kernel/context/request-context.js';
import { DATABASE } from '../../kernel/database/database.token.js';
import { Endpoint } from '../../kernel/contract/endpoint.decorator.js';
import { bucketKey, RateLimiter } from '../../kernel/rate-limit/rate-limiter.js';
import { ZodValidationPipe } from '../../kernel/validation/zod-validation.pipe.js';
import { Public, SignedIn } from '../access/access-policy.js';
import { AuditService } from '../audit/audit.service.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { clearSessionCookie, setSessionCookie } from './session-cookie.js';
import { SessionService } from './session.service.js';

const HOUR = 3600;
const QUARTER_HOUR = 900;

@Controller()
export class AuthController {
  constructor(
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RateLimiter) private readonly rateLimiter: RateLimiter,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DATABASE) private readonly database: DatabaseHandle,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Endpoint(endpoints.auth.requestOtp)
  async requestOtp(
    @Body(new ZodValidationPipe(endpoints.auth.requestOtp.body)) body: OtpRequest,
    @Req() request: FastifyRequest,
  ) {
    // Per number: stops SMS bombing one person. Per IP: stops one client spraying numbers.
    await this.rateLimiter.consume(`otp-request:phone:${bucketKey(body.phone)}`, 5, HOUR);
    await this.rateLimiter.consume(`otp-request:ip:${bucketKey(request.ip)}`, 30, HOUR);
    const { challengeId, expiresAt } = await this.otp.request(body.phone);
    return { challengeId, expiresAt: expiresAt.toISOString() };
  }

  @Public()
  @Endpoint(endpoints.auth.verifyOtp)
  async verifyOtp(
    @Body(new ZodValidationPipe(endpoints.auth.verifyOtp.body)) body: OtpVerify,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.rateLimiter.consume(`otp-verify:ip:${bucketKey(request.ip)}`, 60, QUARTER_HOUR);
    const { userId, isNewUser } = await this.otp.verify(body);
    return this.startSession(
      userId,
      request,
      reply,
      isNewUser ? 'user.registered' : 'auth.signed_in',
      'otp',
    );
  }

  @Public()
  @Endpoint(endpoints.auth.passwordLogin)
  async passwordLogin(
    @Body(new ZodValidationPipe(endpoints.auth.passwordLogin.body)) body: PasswordLogin,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.rateLimiter.consume(`password:phone:${bucketKey(body.phone)}`, 10, QUARTER_HOUR);
    await this.rateLimiter.consume(`password:ip:${bucketKey(request.ip)}`, 60, QUARTER_HOUR);
    const userId = await this.passwords.verify(body.phone, body.password);
    return this.startSession(userId, request, reply, 'auth.signed_in', 'password');
  }

  @SignedIn()
  @Endpoint(endpoints.auth.logout)
  async logout(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const { sessionId } = RequestContext.require();
    if (sessionId) await this.sessions.revoke(sessionId);
    clearSessionCookie(reply, this.config);
    await this.audit.recordStandalone({
      action: 'auth.signed_out',
      entityType: 'session',
      ...(sessionId ? { entityId: sessionId } : {}),
    });
  }

  private async startSession(
    userId: Id,
    request: FastifyRequest,
    reply: FastifyReply,
    action: 'user.registered' | 'auth.signed_in',
    method: 'otp' | 'password',
  ) {
    const session = await this.sessions.create(userId, {
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    setSessionCookie(reply, this.config, session.token, session.expiresAt);

    // From here on the request acts as the signed-in user (audit actor).
    const context = RequestContext.require();
    context.userId = userId;
    context.sessionId = session.sessionId;
    await this.audit.recordStandalone({
      action,
      entityType: 'session',
      entityId: session.sessionId,
      changes: { method },
    });

    const [user] = await this.database.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    // The token is only in the HttpOnly cookie, never in the body (no JavaScript access).
    return { user, sessionExpiresAt: session.expiresAt.toISOString() };
  }
}
