import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, BadRequestError, InternalServerError } from '@/common/errors/app-error';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { IUserRepository } from '../../database/user.repository.port';
import { PasswordResetTokenRepository, SessionRepository } from '../../database/session.repository';
import { UserMapper } from '../../auth.mapper';
import { HashedPassword } from '../../domain/value-objects/hashed-password.value-object';
import { passwordUtil } from '../../utils/password.util';
import { ResetPasswordRequestDto } from './reset-password.request.dto';

export class ResetPasswordService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly resetTokenRepository: PasswordResetTokenRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly logger: Logger
  ) {}

  async execute(dto: ResetPasswordRequestDto): Promise<{ message: string }> {
    this.logger.info({ phone: dto.phone }, 'ResetPasswordService: reset attempt');

    const correlationId = crypto.randomUUID();

    // 1. Resolve the user by phone. Use a generic error so the endpoint does not
    //    reveal whether the phone is registered.
    const userRecord = await this.userRepository.findByPhone(dto.phone);
    if (!userRecord || userRecord.deletedAt !== null) {
      throw new BadRequestError('Invalid or expired OTP');
    }

    // 2. Find a valid OTP scoped to this user. The OTP is the single secret
    //    delivered via SMS — there is no separate client-held reset token.
    const tokenRecord = await this.resetTokenRepository.findValidByUserId({
      userId: userRecord.id,
      otpCode: dto.otpCode,
    });
    if (!tokenRecord) {
      throw new BadRequestError('Invalid or expired OTP');
    }

    // 3. Hash new password
    const rawHash = await passwordUtil.hash(dto.newPassword);
    const hashedPassword = HashedPassword.create(rawHash);

    // 4. Domain: change password + emit event
    const userEntity = UserMapper.toDomain(userRecord);
    userEntity.changePassword(hashedPassword, correlationId);

    // 5. Atomic transaction: mark token used, update password, revoke all sessions
    try {
      await prisma.$transaction(async (tx) => {
        const ptx = tx as unknown as PrismaTransaction;
        await this.resetTokenRepository.markUsed(tokenRecord.id, ptx);
        await this.userRepository.update(
          userRecord.id,
          { passwordHash: hashedPassword.unpack() },
          ptx
        );
        await this.sessionRepository.revokeAll(userRecord.id, ptx);
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ error }, 'ResetPasswordService: transaction failed');
      throw new InternalServerError('Password reset failed. Please try again.');
    }

    this.logger.info(
      { userId: userRecord.id.toString() },
      'ResetPasswordService: password reset successful'
    );

    return { message: 'Password updated successfully. Please log in with your new password.' };
  }
}
