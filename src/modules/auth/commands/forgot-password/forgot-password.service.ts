import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { IUserRepository } from '../../database/user.repository.port';
import { PasswordResetTokenRepository } from '../../database/session.repository';
import { SmsNotificationPort } from '../../ports/sms-notification.port';
import { ForgotPasswordRequestDto } from './forgot-password.request.dto';

export class ForgotPasswordService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly resetTokenRepository: PasswordResetTokenRepository,
    private readonly smsService: SmsNotificationPort,
    private readonly logger: Logger
  ) {}

  async execute(dto: ForgotPasswordRequestDto): Promise<{ message: string }> {
    this.logger.info({ phone: dto.phone }, 'ForgotPasswordService: request received');

    // Phone enumeration prevention — always return same response
    const userRecord = await this.userRepository.findByPhone(dto.phone);
    if (!userRecord || userRecord.deletedAt !== null) {
      this.logger.info(
        { phone: dto.phone },
        'ForgotPasswordService: phone not found, returning early'
      );
      return { message: 'If an account with this phone number exists, an OTP has been sent.' };
    }

    // Generate 6-digit OTP and reset token
    const otp = crypto.randomInt(100000, 1000000).toString();
    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.resetTokenRepository.create({
      userId: userRecord.id,
      resetToken,
      otpCode: otp,
      expiresAt,
    });

    // SMS stub — logs OTP, no real delivery
    await this.smsService.sendOtp(dto.phone, otp);

    this.logger.info({ userId: userRecord.id.toString() }, 'ForgotPasswordService: OTP generated');

    return { message: 'If an account with this phone number exists, an OTP has been sent.' };
  }
}
