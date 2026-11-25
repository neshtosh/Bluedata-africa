import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../kernel/config/app-config.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AuthController } from './auth.controller.js';
import { MeController } from './me.controller.js';
import { OtpService } from './otp.service.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { LogSmsSender, SMS_SENDER, type SmsSender } from './sms-sender.js';

@Module({
  imports: [TenancyModule],
  controllers: [AuthController, MeController],
  providers: [
    SessionService,
    OtpService,
    PasswordService,
    {
      provide: SMS_SENDER,
      inject: [APP_CONFIG],
      // Only the development provider exists; config refuses it in production.
      useFactory: (config: AppConfig): SmsSender => {
        switch (config.SMS_PROVIDER) {
          case 'log':
            return new LogSmsSender();
        }
      },
    },
  ],
  exports: [SessionService],
})
export class IdentityModule {}
