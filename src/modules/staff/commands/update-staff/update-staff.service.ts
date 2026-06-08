import crypto from 'crypto';
import { VendorUserStatus } from '@prisma/client';
import { Logger } from '@/infrastructure/logger/logger';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import {
  AppError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { PermissionGrant } from '../../domain/vendor-membership.types';
import { SessionRevocationHandler } from '../../handlers/session-revocation.handler';
import { StaffResponseDto } from '../../staff.types';
import { UpdateStaffRequestDto } from './update-staff.request.dto';

export class UpdateStaffService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly sessionRevocation: SessionRevocationHandler,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: update a staff member's status, area, and/or permission grants. */
  async execute(dto: UpdateStaffRequestDto): Promise<StaffResponseDto> {
    const correlationId = crypto.randomUUID();

    // 1. Load + multi-tenant guard (mask wrong vendor as 404).
    const record = await this.membershipRepository.findById(dto.staffId);
    if (!record || record.vendorId !== dto.vendorId || record.deletedAt !== null) {
      throw new NotFoundError('Staff member not found');
    }

    const entity = StaffMapper.toDomain(record);

    // 2. Owner self-guard (OQ-6): staff endpoints never act on an owner membership.
    if (entity.isOwner) {
      throw new ForbiddenError('Cannot modify the owner membership');
    }

    const actions: AuditAction[] = [];

    try {
      await prisma.$transaction(async (txClient) => {
        const tx = txClient as unknown as PrismaTransaction;

        // 3. Status transition (domain state machine enforces legality → 422).
        if (dto.status !== undefined && dto.status !== entity.status) {
          if (dto.status === VendorUserStatus.DISABLED) {
            entity.disable(dto.performedByUserId, correlationId);
            actions.push(AuditAction.STAFF_DISABLED);
          } else if (dto.status === VendorUserStatus.ACTIVE) {
            entity.enable(correlationId);
            actions.push(AuditAction.STAFF_ENABLED);
          }
        }

        // 4. Area label.
        if (dto.areaRouteLabel !== undefined) {
          entity.updateArea(dto.areaRouteLabel);
        }

        // 5. Permission grants (replace).
        if (dto.permissions !== undefined) {
          const grants: PermissionGrant[] = dto.permissions.map((key) => ({
            key,
            granted: true,
          }));
          entity.setPermissions(grants, correlationId);
          actions.push(AuditAction.STAFF_PERMISSIONS_CHANGED);
        }

        const props = entity.getProps();
        await this.membershipRepository.update(
          dto.staffId,
          {
            status: props.status,
            areaRouteLabel: props.areaRouteLabel,
            disabledAt: props.disabledAt,
          },
          tx
        );

        if (dto.permissions !== undefined) {
          await this.membershipRepository.replacePermissions(
            dto.staffId,
            StaffMapper.toGrantInputs(entity),
            tx
          );
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'UpdateStaffService: transaction failed');
      throw new InternalServerError('Failed to update staff member. Please try again.');
    }

    // 6. Revoke active sessions when the member was disabled (edge case #6).
    if (actions.includes(AuditAction.STAFF_DISABLED)) {
      await this.sessionRevocation.revokeAllForUser(record.userId, 'staff_disabled', correlationId);
    }

    // 7. Audit each effect (canonical path; J does not double-log).
    for (const action of actions) {
      await this.auditLogger.log({
        vendorId: dto.vendorId,
        performedByUserId: dto.performedByUserId,
        performedByRole: dto.performedByRole,
        action,
        entityType: 'staff',
        entityId: dto.staffId,
        metadata: { status: dto.status, permissions: dto.permissions },
        ipAddress: dto.ip,
        userAgent: dto.userAgent,
        correlationId,
      });
    }

    const fresh = await this.membershipRepository.findById(dto.staffId);
    if (!fresh) {
      throw new InternalServerError('Failed to load updated staff member.');
    }

    this.logger.info(
      { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString(), correlationId },
      'UpdateStaffService: update successful'
    );

    return StaffMapper.toResponse(StaffMapper.toDomain(fresh), fresh, {
      assignedListCount: 0,
      assignedListIds: [],
    });
  }
}
