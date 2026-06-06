import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { AppError, InternalServerError, NotFoundError } from '@/common/errors/app-error';
import { IUserRepository } from '../../database/user.repository.port';
import { IVendorRepository } from '../../database/vendor.repository.port';
import { SessionRepository } from '../../database/session.repository';
import { UserEntity } from '../../domain/user.entity';
import { VendorEntity } from '../../domain/vendor.entity';
import { PhoneNumber } from '../../domain/value-objects/phone-number.value-object';
import { HashedPassword } from '../../domain/value-objects/hashed-password.value-object';
import { UserMapper, VendorMapper } from '../../auth.mapper';
import { jwtUtil } from '../../utils/jwt.util';
import { passwordUtil } from '../../utils/password.util';
import { SignupResponseDto } from '../../auth.types';
import { SignupRequestDto } from './signup.request.dto';

export class SignupService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly vendorRepository: IVendorRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly logger: Logger
  ) {}

  async execute(dto: SignupRequestDto): Promise<SignupResponseDto> {
    this.logger.info(
      { phone: dto.phone, vendorName: dto.vendorName },
      'SignupService: starting signup'
    );

    const correlationId = crypto.randomUUID();

    // 1. Create PhoneNumber VO
    const phone = PhoneNumber.create(dto.phone);

    // 2. Hash password in application service
    const rawHash = await passwordUtil.hash(dto.password);

    // 3. Create HashedPassword VO
    const passwordHash = HashedPassword.create(rawHash);

    // 4. Build domain entities (temporary id — replaced by DB)
    const userEntity = UserEntity.create({ phone, passwordHash });
    const vendorEntity = VendorEntity.create({ name: dto.vendorName });

    let persistedUser: ReturnType<typeof UserMapper.toDomain>;
    let persistedVendor: ReturnType<typeof VendorMapper.toDomain>;
    let ownerRoleName: string;

    // 5. Atomic transaction: user → vendor → vendorUser
    try {
      const result = await prisma.$transaction(async (tx) => {
        const ptx = tx as unknown as PrismaTransaction;

        // 5a. Insert User
        const userRecord = await this.userRepository.insert(
          UserMapper.toPersistence(userEntity),
          ptx
        );

        // 5b. Insert Vendor
        const vendorRecord = await this.vendorRepository.insert(
          VendorMapper.toPersistence(vendorEntity),
          ptx
        );

        // 5c. Lookup vendor_owner role
        const ownerRole = await tx.role.findFirst({ where: { name: 'vendor_owner' } });
        if (!ownerRole) {
          throw new NotFoundError('vendor_owner role not seeded — run npm run db:seed first');
        }

        // 5d. Create VendorUser row
        await tx.vendorUser.create({
          data: {
            vendorId: vendorRecord.id,
            userId: userRecord.id,
            roleId: ownerRole.id,
            status: 'ACTIVE',
            joinedAt: new Date(),
          },
        });

        return { userRecord, vendorRecord, ownerRole };
      });

      persistedUser = UserMapper.toDomain(result.userRecord);
      persistedVendor = VendorMapper.toDomain(result.vendorRecord);
      ownerRoleName = result.ownerRole.name;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ error }, 'SignupService: transaction failed');
      throw new InternalServerError('Registration failed. Please try again.');
    }

    // 6. Generate tokens
    const accessToken = jwtUtil.generateAccessToken({
      userId: persistedUser.id.toString(),
      phone: persistedUser.getProps().phone.unpack(),
      vendorIds: [persistedVendor.id.toString()],
    });

    const refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const tempSessionId = crypto.randomUUID();
    const refreshToken = jwtUtil.generateRefreshToken({
      userId: persistedUser.id.toString(),
      sessionId: tempSessionId,
    });

    // 7. Persist session
    const session = await this.sessionRepository.create({
      user: { connect: { id: persistedUser.id } },
      accessToken,
      refreshToken,
      ipAddress: dto.ip ?? null,
      userAgent: dto.userAgent ?? null,
      expiresAt: refreshTokenExpiry,
      lastActivityAt: new Date(),
    });

    // 8. Emit domain events (fire-and-forget for v1 — no AuditLog module yet)
    persistedUser.emitRegisteredEvent(persistedVendor.id, correlationId);
    persistedVendor.emitCreatedEvent(persistedUser.id, correlationId);
    void session; // session persisted

    this.logger.info(
      { userId: persistedUser.id.toString(), vendorId: persistedVendor.id.toString() },
      'SignupService: signup successful'
    );

    // 9. Return response DTO
    return {
      user: UserMapper.toResponse(persistedUser),
      tokens: { accessToken, refreshToken },
      vendorContext: VendorMapper.toResponse(persistedVendor, ownerRoleName),
    };
  }
}
