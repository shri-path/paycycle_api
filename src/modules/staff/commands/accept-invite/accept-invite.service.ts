import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { IUserRepository } from '@/modules/auth/database/user.repository.port';
import {
  SessionRepository,
  VendorUserRepository,
} from '@/modules/auth/database/session.repository';
import { UserMapper } from '@/modules/auth/auth.mapper';
import { jwtUtil, JwtVendorClaim } from '@/modules/auth/utils/jwt.util';
import { passwordUtil } from '@/modules/auth/utils/password.util';
import { LoginResponseDto, VendorContextDto } from '@/modules/auth/auth.types';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { IStaffInvitationRepository } from '../../database/staff-invitation.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { InviteToken } from '../../domain/value-objects/invite-token.value-object';
import { InvalidInviteError } from '../../domain/staff.errors';
import { StaffInvitationEntity } from '../../domain/staff-invitation.entity';
import { AcceptInviteRequestDto } from './accept-invite.request.dto';

const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class AcceptInviteService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly invitationRepository: IStaffInvitationRepository,
    private readonly userRepository: IUserRepository,
    private readonly sessionRepository: SessionRepository,
    private readonly vendorUserRepository: VendorUserRepository,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command (public): accept an invite, activate the membership, auto-login. */
  async execute(dto: AcceptInviteRequestDto): Promise<LoginResponseDto> {
    const correlationId = crypto.randomUUID();

    // 1. Resolve the invitation by token hash. Unknown → 404 (don't reveal validity).
    const tokenHash = InviteToken.hash(dto.token);
    const invRecord = await this.invitationRepository.findByTokenHash(tokenHash);
    if (!invRecord) {
      throw new InvalidInviteError('Invitation not found or already used');
    }

    const invitation = StaffInvitationEntity.reconstitute({
      id: invRecord.id,
      createdAt: invRecord.createdAt,
      updatedAt: invRecord.updatedAt,
      props: {
        vendorId: invRecord.vendorId,
        vendorUserId: invRecord.vendorUserId,
        invitedByUserId: invRecord.invitedByUserId,
        phone: invRecord.phone,
        tokenHash: invRecord.tokenHash,
        status: invRecord.status,
        expiresAt: invRecord.expiresAt,
        acceptedAt: invRecord.acceptedAt,
        revokedAt: invRecord.revokedAt,
      },
    });

    // 2. Load the membership.
    const membershipRecord = await this.membershipRepository.findById(invitation.vendorUserId);
    if (!membershipRecord) {
      throw new InvalidInviteError('Invitation not found or already used');
    }

    // 3. Guard + state transitions (throws ExpiredInviteError 422 / InvalidInviteError 404).
    invitation.accept(); // mutates to ACCEPTED or throws
    const membership = StaffMapper.toDomain(membershipRecord);
    membership.activate(correlationId);

    const passwordHash = await passwordUtil.hash(dto.password);

    try {
      await prisma.$transaction(async (txClient) => {
        const tx = txClient as unknown as PrismaTransaction;

        // 3a. Set the real password (and name if provided) on the user.
        await this.userRepository.update(
          membershipRecord.userId,
          { passwordHash, ...(dto.name ? { name: dto.name } : {}) },
          tx
        );

        // 3b. Activate the membership.
        const props = membership.getProps();
        await this.membershipRepository.update(
          membershipRecord.id,
          { status: props.status, joinedAt: props.joinedAt },
          tx
        );

        // 3c. Accept the invitation (single-use).
        const invProps = invitation.getProps();
        await this.invitationRepository.update(
          invitation.id,
          { status: invProps.status, acceptedAt: invProps.acceptedAt },
          tx
        );
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'AcceptInviteService: transaction failed');
      throw new InternalServerError('Failed to accept invitation. Please try again.');
    }

    // 4. Issue JWT with role+permissions per vendor (OQ-2).
    const userRecord = await this.userRepository.findById(membershipRecord.userId);
    if (!userRecord) {
      throw new InternalServerError('Failed to load user after accept.');
    }

    const claims = await this.vendorUserRepository.findVendorClaimsByUserId(userRecord.id);
    const vendorClaims: JwtVendorClaim[] = claims.map((c) => ({
      vendorId: c.vendorId.toString(),
      role: c.roleName,
      permissions: c.permissions,
    }));
    const vendorIds = claims.map((c) => c.vendorId.toString());

    const accessToken = jwtUtil.generateAccessToken({
      userId: userRecord.id.toString(),
      phone: userRecord.phone,
      vendorIds,
      vendors: vendorClaims,
    });
    const sessionId = crypto.randomUUID();
    const refreshToken = jwtUtil.generateRefreshToken({
      userId: userRecord.id.toString(),
      sessionId,
    });

    await this.sessionRepository.create({
      user: { connect: { id: userRecord.id } },
      accessToken,
      refreshToken,
      ipAddress: dto.ip ?? null,
      userAgent: dto.userAgent ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      lastActivityAt: new Date(),
    });

    // 5. Audit (canonical path).
    await this.auditLogger.log({
      vendorId: invitation.vendorId,
      performedByUserId: userRecord.id,
      performedByRole: 'vendor_staff',
      action: AuditAction.STAFF_JOINED,
      entityType: 'staff',
      entityId: membershipRecord.id,
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    const vendorContexts: VendorContextDto[] = (
      await this.vendorUserRepository.findActiveContextsByUserId(userRecord.id)
    ).map((c) => ({
      vendorId: c.vendorId.toString(),
      vendorName: c.vendorName,
      role: c.roleName,
    }));

    this.logger.info(
      { userId: userRecord.id.toString(), vendorId: invitation.vendorId.toString(), correlationId },
      'AcceptInviteService: invite accepted (auto-login)'
    );

    return {
      user: UserMapper.toResponse(UserMapper.toDomain(userRecord)),
      tokens: { accessToken, refreshToken },
      vendorContexts,
    };
  }
}
