import { Logger } from '@/infrastructure/logger/logger';
import { SmsNotificationPort } from '../ports/sms-notification.port';

export class SmsStubAdapter implements SmsNotificationPort {
  constructor(private readonly logger: Logger) {}

  sendOtp(phone: string, otp: string): Promise<void> {
    this.logger.info({ phone, otp }, '[SMS STUB] Would send OTP via SMS — not delivered in v1');
    // No real delivery. Resolves immediately.
    return Promise.resolve();
  }
}
