import { Logger } from '@nestjs/common';

/**
 * Port for SMS delivery (ARCHITECTURE.md §4.2 — external services behind adapters). Real
 * providers are added once one is chosen and contracted; none is assumed.
 */
export interface SmsSender {
  send(toE164: string, message: string): Promise<void>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

/**
 * Development/test only: writes the message to the log so a developer can read the code.
 * Configuration refuses this provider in production (app-config.ts).
 */
export class LogSmsSender implements SmsSender {
  private readonly logger = new Logger('DevSms');

  async send(toE164: string, message: string): Promise<void> {
    this.logger.warn(`[DEV SMS - not delivered] to ${maskPhone(toE164)}: ${message}`);
  }
}

/** SMS switched off (ADR-019). Never reached: sign-in by code is refused before sending. */
export class NoSmsSender implements SmsSender {
  async send(): Promise<void> {
    throw new Error('SMS is switched off (SMS_PROVIDER=none)');
  }
}

/** Keeps country code and last two digits: +254*******01. */
export function maskPhone(e164: string): string {
  return e164.length <= 6
    ? '***'
    : `${e164.slice(0, 4)}${'*'.repeat(e164.length - 6)}${e164.slice(-2)}`;
}
