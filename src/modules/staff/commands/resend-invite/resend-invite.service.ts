import crypto from 'crypto';
import { VendorUserStatus } from '@prisma/client';
import { Logger } from '@/infrastructure/logger/logger';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { AppError, InternalServerError, NotFoundError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { IStaffInvitationRepository } from '../../database/staff-invitation.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { StaffInvitationEntity } from '../../domain/staff-invitation.entity';
import { InviteToken } from '../../domain/value-objects/invite-token.value-object';
import { InvalidStatusTransitionError } from '../../domain/staff.errors';
import { StaffNotificationPort } from '../../ports/staff-notification.port';
import { ResendInviteResponseDto } from '../../staff.types';
import { ResendInviteRequestDto } from './resend-invite.request.dto';

/**
 * Command: re-issue a staff invitation. Allowed only while the membership is
 * still INVITED. Rotates the token (prior PENDING invite → REVOKED, one fresh
 * PENDING invite), increments sent_count, and re-delivers over the chosen channel.
 */
export class ResendInviteService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly invitationRepository: IStaffInvitationRepository,
    private readonly notificationPort: StaffNotificationPort,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  async execute(dto: ResendInviteRequestDto): Promise<ResendInviteResponseDto> {
    const correlationId = crypto.randomUUID();
    this.logger.info(
      { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString(), correlationId },
      'ResendInviteService: resend attempt'
    );

    // 1. Load + multi-tenant guard (mask wrong vendor / removed as 404).
    const record = await this.membershipRepository.findById(dto.staffId);
    if (!record || record.vendorId !== dto.vendorId || record.deletedAt !== null) {
      this.logger.warn(
        { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString(), correlationId },
        'ResendInviteService: staff not found or tenant mismatch'
      );
      throw new NotFoundError('Staff member not found');
    }

    // 2. Only a still-pending invitation can be resent.
    if (record.status !== VendorUserStatus.INVITED) {
      this.logger.warn(
        { staffId: dto.staffId.toString(), status: record.status, correlationId },
        'ResendInviteService: resend blocked — membership is not INVITED'
      );
      throw new InvalidStatusTransitionError('Only pending invitations can be resent');
    }

    const phone = record.phone ?? record.user?.phone ?? null;
    if (!phone) {
      this.logger.warn(
        { staffId: dto.staffId.toString(), correlationId },
        'ResendInviteService: invited staff has no phone on record'
      );
      throw new InternalServerError('Invited staff member has no phone on record.');
    }

    // 3. Compute the next send count from the latest invitation (any status).
    const latest = await this.invitationRepository.findLatestByMembership(dto.staffId);
    const nextSentCount = (latest?.sentCount ?? 0) + 1;

    const { raw: rawToken } = InviteToken.generate();
    let invitationEntity: StaffInvitationEntity;

    try {
      invitationEntity = await prisma.$transaction(async (txClient) => {
        const tx = txClient as unknown as PrismaTransaction;

        // 3a. Invalidate any outstanding PENDING token.
        await this.invitationRepository.revokePendingByMembership(dto.staffId, tx);

        // 3b. Issue a fresh single-use token (7-day expiry).
        const invitation = StaffInvitationEntity.create(
          {
            vendorId: dto.vendorId,
            vendorUserId: dto.staffId,
            invitedByUserId: dto.performedByUserId,
            phone,
          },
          rawToken
        );
        const invProps = invitation.getProps();
        await this.invitationRepository.insert(
          {
            vendor: { connect: { id: dto.vendorId } },
            vendorUser: { connect: { id: dto.staffId } },
            invitedByUserId: dto.performedByUserId,
            phone: invProps.phone,
            tokenHash: invProps.tokenHash,
            status: invProps.status,
            expiresAt: invProps.expiresAt,
            sentVia: StaffMapper.toInvitationChannel(dto.sendVia),
            sentCount: nextSentCount,
            lastSentAt: new Date(),
          },
          tx
        );

        return invitation;
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'ResendInviteService: transaction failed');
      throw new InternalServerError('Failed to resend invitation. Please try again.');
    }

    const inviteMeta = StaffMapper.invitationToResponse(invitationEntity, rawToken);

    // 4. Re-deliver over the chosen channel (log-and-continue stub).
    const vendor = await prisma.vendor.findUnique({
      where: { id: dto.vendorId },
      select: { name: true },
    });
    await this.notificationPort.sendStaffInvite({
      phone,
      vendorName: vendor?.name ?? 'PayCycle',
      inviteUrl: inviteMeta.inviteUrl,
      channel: dto.sendVia ?? 'whatsapp',
      expiresAt: invitationEntity.expiresAt,
      correlationId,
    });

    // 5. Audit.
    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.performedByUserId,
      performedByRole: dto.performedByRole,
      action: AuditAction.STAFF_INVITE_RESENT,
      entityType: 'staff',
      entityId: dto.staffId,
      metadata: { sentVia: dto.sendVia, sentCount: nextSentCount },
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    return {
      inviteUrl: inviteMeta.inviteUrl,
      expiresAt: inviteMeta.expiresAt,
      sentVia: dto.sendVia,
    };
  }
}
