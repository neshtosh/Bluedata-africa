import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../kernel/config/app-config.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuthController } from './auth.controller.js';
import { MeController } from './me.controller.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { LogSmsSender, NoSmsSender, SMS_SENDER, type SmsSender } from './sms-sender.js';
import { SetupLinkService } from './setup-link.service.js';

@Module({
  imports: [TenancyModule],
  controllers: [AuthController, MeController],
  providers: [
    SessionService,
    OtpService,
    PasswordService,
    SetupLinkService,
    {
      provide: SMS_SENDER,
      inject: [APP_CONFIG],
      // Only the development provider exists; config refuses it in production. With `none`,
      // AuthController refuses OTP requests before anything would be sent.
      useFactory: (config: AppConfig): SmsSender => {
        switch (config.SMS_PROVIDER) {
          case 'log':
            return new LogSmsSender();
          case 'none':
            return new NoSmsSender();
        }
      },
    },
  ],
  exports: [SessionService, SetupLinkService],
})
export class IdentityModule {}
