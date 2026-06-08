import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { UnauthorizedError } from '@/common/errors/app-error';
import { IUserRepository } from '../../database/user.repository.port';
import { SessionRepository, VendorUserRepository } from '../../database/session.repository';
import { UserMapper } from '../../auth.mapper';
import { jwtUtil } from '../../utils/jwt.util';
import { passwordUtil } from '../../utils/password.util';
import { LoginResponseDto, VendorContextDto } from '../../auth.types';
import { LoginRequestDto } from './login.request.dto';

export class LoginService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly vendorUserRepository: VendorUserRepository,
    private readonly logger: Logger
  ) {}

  async execute(dto: LoginRequestDto): Promise<LoginResponseDto> {
    this.logger.info({ phone: dto.phone }, 'LoginService: login attempt');

    const correlationId = crypto.randomUUID();

    // 1. Find user by phone — generic error to prevent enumeration
    const userRecord = await this.userRepository.findByPhone(dto.phone);
    if (!userRecord || userRecord.deletedAt !== null) {
      this.logger.warn({ phone: dto.phone }, 'LoginService: user not found or deleted');
      throw new UnauthorizedError('Invalid credentials');
    }

    // 2. Compare password
    const isValid = await passwordUtil.compare(dto.password, userRecord.passwordHash);
    if (!isValid) {
      this.logger.warn({ userId: userRecord.id.toString() }, 'LoginService: wrong password');
      throw new UnauthorizedError('Invalid credentials');
    }

    // 3. Reconstitute domain entity and record login
    const userEntity = UserMapper.toDomain(userRecord);
    userEntity.recordLogin(correlationId, dto.ip, dto.userAgent);

    // 4. Persist updated lastLoginAt
    await this.userRepository.update(userRecord.id, {
      lastLoginAt: userEntity.getProps().lastLoginAt,
    });

    // 5. Load vendor contexts
    const contexts = await this.vendorUserRepository.findActiveContextsByUserId(userRecord.id);
    const vendorIds = contexts.map((c) => c.vendorId.toString());

    // 6. Generate tokens
    const accessToken = jwtUtil.generateAccessToken({
      userId: userRecord.id.toString(),
      phone: userRecord.phone,
      vendorIds,
    });

    const refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tempSessionId = crypto.randomUUID();
    const refreshToken = jwtUtil.generateRefreshToken({
      userId: userRecord.id.toString(),
      sessionId: tempSessionId,
    });

    // 7. Persist session
    await this.sessionRepository.create({
      user: { connect: { id: userRecord.id } },
      accessToken,
      refreshToken,
      ipAddress: dto.ip ?? null,
      userAgent: dto.userAgent ?? null,
      deviceId: dto.deviceId ?? null,
      expiresAt: refreshTokenExpiry,
      lastActivityAt: new Date(),
    });

    this.logger.info({ userId: userRecord.id.toString() }, 'LoginService: login successful');

    const vendorContexts: VendorContextDto[] = contexts.map((c) => ({
      vendorId: c.vendorId.toString(),
      vendorName: c.vendorName,
      role: c.roleName,
    }));

    return {
      user: UserMapper.toResponse(userEntity),
      tokens: { accessToken, refreshToken },
      vendorContexts,
    };
  }
}
