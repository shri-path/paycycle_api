import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError, UnauthorizedError } from '@/common/errors/app-error';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { IUserRepository } from '../../database/user.repository.port';
import { SessionRepository, VendorUserRepository } from '../../database/session.repository';
import { jwtUtil } from '../../utils/jwt.util';
import { RefreshResponseDto } from '../../auth.types';
import { RefreshTokenRequestDto } from './refresh-token.request.dto';

export class RefreshTokenService {
  constructor(
    private readonly sessionRepository: SessionRepository,
    private readonly userRepository: IUserRepository,
    private readonly vendorUserRepository: VendorUserRepository,
    private readonly logger: Logger
  ) {}

  async execute(dto: RefreshTokenRequestDto): Promise<RefreshResponseDto> {
    this.logger.info('RefreshTokenService: token refresh attempt');

    // 1. Verify JWT signature
    const payload = jwtUtil.verifyRefreshToken(dto.refreshToken);

    // 2. Find active session — findByRefreshToken filters revokedAt IS NULL
    const session = await this.sessionRepository.findByRefreshToken(dto.refreshToken);
    if (!session) {
      this.logger.warn({ userId: payload.userId }, 'RefreshTokenService: token reuse or not found');
      throw new UnauthorizedError('Invalid or revoked refresh token');
    }

    // 3. Load user and vendor contexts so access token carries valid claims
    const userId = BigInt(payload.userId);
    const user = await this.userRepository.findById(userId);
    if (!user || user.deletedAt !== null) {
      this.logger.warn({ userId: payload.userId }, 'RefreshTokenService: user no longer exists');
      throw new UnauthorizedError('User no longer exists');
    }

    const contexts = await this.vendorUserRepository.findActiveContextsByUserId(userId);
    const vendorIds = contexts.map((c) => c.vendorId.toString());

    // 4. Rotate: revoke old, create new
    const newSessionId = crypto.randomUUID();
    const refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const newAccessToken = jwtUtil.generateAccessToken({
      userId: payload.userId,
      phone: user.phone,
      vendorIds,
    });

    const newRefreshToken = jwtUtil.generateRefreshToken({
      userId: payload.userId,
      sessionId: newSessionId,
    });

    try {
      await prisma.$transaction(async (tx) => {
        const ptx = tx as unknown as PrismaTransaction;
        await this.sessionRepository.revoke(session.id, ptx);
        await this.sessionRepository.create(
          {
            user: { connect: { id: session.userId } },
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            ipAddress: dto.ip ?? null,
            userAgent: dto.userAgent ?? null,
            expiresAt: refreshTokenExpiry,
            lastActivityAt: new Date(),
          },
          ptx
        );
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ error }, 'RefreshTokenService: transaction failed');
      throw new InternalServerError('Token refresh failed. Please try again.');
    }

    this.logger.info({ userId: payload.userId }, 'RefreshTokenService: token rotated successfully');

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }
}
