import crypto from 'crypto';
import { VendorUserStatus } from '@prisma/client';
import { Logger } from '@/infrastructure/logger/logger';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import {
  AppError,
  ConflictError,
  InternalServerError,
  NotFoundError,
} from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { IUserRepository } from '@/modules/auth/database/user.repository.port';
import { passwordUtil } from '@/modules/auth/utils/password.util';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { IStaffInvitationRepository } from '../../database/staff-invitation.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { VendorMembershipEntity } from '../../domain/vendor-membership.entity';
import { StaffInvitationEntity } from '../../domain/staff-invitation.entity';
import { InviteToken } from '../../domain/value-objects/invite-token.value-object';
import { PermissionGrant, STAFF_ROLE_NAME } from '../../domain/vendor-membership.types';
import { StaffInvitedEvent } from '../../domain/events/staff-invited.domain-event';
import { SubscriptionLimitError } from '../../domain/staff.errors';
import { SubscriptionLimitPort } from '../../ports/subscription-limit.port';
import { InviteStaffResponseDto } from '../../staff.types';
import { InviteStaffRequestDto } from './invite-staff.request.dto';

export class InviteStaffService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly invitationRepository: IStaffInvitationRepository,
    private readonly userRepository: IUserRepository,
    private readonly subscriptionLimitPort: SubscriptionLimitPort,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: invite a new staff member (or re-invite a removed one). */
  async execute(dto: InviteStaffRequestDto): Promise<InviteStaffResponseDto> {
    const correlationId = crypto.randomUUID();
    this.logger.info(
      { vendorId: dto.vendorId.toString(), correlationId },
      'InviteStaffService: invite attempt'
    );

    // 1. Subscription staff-limit gate (OQ-7 — stub allows all in v1).
    const limit = await this.subscriptionLimitPort.getStaffLimit(dto.vendorId);
    if (limit !== null) {
      const current = await this.subscriptionLimitPort.getCurrentStaffCount(dto.vendorId);
      if (current >= limit) {
        this.logger.warn(
          { vendorId: dto.vendorId.toString(), limit, current, correlationId },
          'InviteStaffService: subscription staff limit reached'
        );
        throw new SubscriptionLimitError(
          'Your subscription staff limit has been reached. Upgrade to add more staff.'
        );
      }
    }

    // 2. Resolve the staff role.
    const staffRole = await prisma.role.findFirst({ where: { name: STAFF_ROLE_NAME } });
    if (!staffRole) {
      throw new NotFoundError(`${STAFF_ROLE_NAME} role not seeded — run npm run db:seed first`);
    }

    // 3. Duplicate / re-invite resolution (OQ-8).
    const existing = await this.membershipRepository.findByVendorAndPhone(dto.vendorId, dto.phone);
    if (existing && existing.status !== VendorUserStatus.REMOVED) {
      this.logger.warn(
        { vendorId: dto.vendorId.toString(), correlationId },
        'InviteStaffService: phone already an active staff member'
      );
      throw new ConflictError('This phone number is already a staff member');
    }

    const grants: PermissionGrant[] = dto.permissions.map((key) => ({ key, granted: true }));
    const { raw: rawToken } = InviteToken.generate();

    let membershipId: bigint;
    let invitationEntity: StaffInvitationEntity;

    try {
      const result = await prisma.$transaction(async (txClient) => {
        const tx = txClient as unknown as PrismaTransaction;

        // 3a. Ensure a User row exists for this phone (placeholder until accept).
        let userRecord = await this.userRepository.findByPhone(dto.phone, tx);
        if (!userRecord) {
          const placeholderHash = await passwordUtil.hash(crypto.randomBytes(24).toString('hex'));
          userRecord = await this.userRepository.insert(
            { phone: dto.phone, passwordHash: placeholderHash, name: dto.name },
            tx
          );
        }

        // 3b. Create or reactivate the membership.
        let membership: VendorMembershipEntity;
        if (existing && existing.status === VendorUserStatus.REMOVED) {
          membership = StaffMapper.toDomain(existing);
          membership.reinvite(grants, dto.areaRouteLabel);
          await this.membershipRepository.update(existing.id, {
            status: VendorUserStatus.INVITED,
            areaRouteLabel: dto.areaRouteLabel,
            invitedAt: new Date(),
            joinedAt: null,
            disabledAt: null,
            removedAt: null,
            deletedAt: null,
          });
          await this.membershipRepository.replacePermissions(
            existing.id,
            StaffMapper.toGrantInputs(membership),
            tx
          );
          membershipId = existing.id;
        } else {
          membership = VendorMembershipEntity.createInvited({
            vendorId: dto.vendorId,
            userId: userRecord.id,
            roleId: staffRole.id,
            roleName: STAFF_ROLE_NAME,
            phone: dto.phone,
            areaRouteLabel: dto.areaRouteLabel,
            permissions: grants,
          });
          const { membership: createInput, grants: grantInputs } =
            StaffMapper.toPersistence(membership);
          const created = await this.membershipRepository.insertWithPermissions(
            createInput,
            grantInputs,
            tx
          );
          membershipId = created.id;
        }

        // 3c. Revoke any prior pending invitations, create the new token.
        await this.invitationRepository.revokePendingByMembership(membershipId, tx);
        const invitation = StaffInvitationEntity.create(
          {
            vendorId: dto.vendorId,
            vendorUserId: membershipId,
            invitedByUserId: dto.invitedByUserId,
            phone: dto.phone,
          },
          rawToken
        );
        const invProps = invitation.getProps();
        await this.invitationRepository.insert(
          {
            vendor: { connect: { id: dto.vendorId } },
            vendorUser: { connect: { id: membershipId } },
            invitedByUserId: dto.invitedByUserId,
            phone: invProps.phone,
            tokenHash: invProps.tokenHash,
            status: invProps.status,
            expiresAt: invProps.expiresAt,
          },
          tx
        );

        return { membershipId, invitation };
      });

      membershipId = result.membershipId;
      invitationEntity = result.invitation;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'InviteStaffService: transaction failed');
      throw new InternalServerError('Failed to invite staff. Please try again.');
    }

    const inviteMeta = StaffMapper.invitationToResponse(invitationEntity, rawToken);

    // 4. Build domain event (fire-and-forget in v1 — no event bus yet; Audit is
    //    the canonical consumer below, Notifications will consume it in a later US).
    const invitedEvent = new StaffInvitedEvent(
      membershipId,
      dto.vendorId,
      dto.phone,
      dto.invitedByUserId,
      inviteMeta.inviteUrl,
      correlationId
    );
    void invitedEvent;

    // 5. Audit (canonical emission path — Stream G owns this; J does not double-log).
    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.invitedByUserId,
      performedByRole: dto.invitedByRole,
      action: AuditAction.STAFF_INVITED,
      entityType: 'staff',
      entityId: membershipId,
      metadata: { phone: dto.phone, permissions: dto.permissions },
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    // 6. Reload the persisted membership for the response.
    const record = await this.membershipRepository.findById(membershipId);
    if (!record) {
      throw new InternalServerError('Failed to load invited staff member.');
    }
    const entity = StaffMapper.toDomain(record);

    this.logger.info(
      { vendorId: dto.vendorId.toString(), staffId: membershipId.toString(), correlationId },
      'InviteStaffService: invite successful'
    );

    return {
      staff: StaffMapper.toResponse(entity, record, { assignedListCount: 0, assignedListIds: [] }),
      inviteUrl: inviteMeta.inviteUrl,
      expiresAt: inviteMeta.expiresAt,
    };
  }
}
