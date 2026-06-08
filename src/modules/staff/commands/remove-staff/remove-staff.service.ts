import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import {
  AppError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { IStaffInvitationRepository } from '../../database/staff-invitation.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { ListAssignmentPort } from '../../ports/list-assignment.port';
import { SessionRevocationHandler } from '../../handlers/session-revocation.handler';
import { RemoveStaffResponseDto } from '../../staff.types';

export interface RemoveStaffRequestDto {
  vendorId: bigint;
  staffId: bigint;
  performedByUserId: bigint;
  performedByRole: string;
  ip: string | null;
  userAgent: string | null;
}

export class RemoveStaffService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly invitationRepository: IStaffInvitationRepository,
    private readonly listAssignmentPort: ListAssignmentPort,
    private readonly sessionRevocation: SessionRevocationHandler,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: soft-remove a staff member (OQ-3 — status REMOVED + deletedAt, 200). */
  async execute(dto: RemoveStaffRequestDto): Promise<RemoveStaffResponseDto> {
    const correlationId = crypto.randomUUID();

    const record = await this.membershipRepository.findById(dto.staffId);
    if (!record || record.vendorId !== dto.vendorId || record.deletedAt !== null) {
      throw new NotFoundError('Staff member not found');
    }

    const entity = StaffMapper.toDomain(record);

    // Owner self-guard (OQ-6).
    if (entity.isOwner) {
      throw new ForbiddenError('Cannot remove the owner membership');
    }

    try {
      entity.remove(dto.performedByUserId, correlationId);
      const props = entity.getProps();

      await this.membershipRepository.update(dto.staffId, {
        status: props.status,
        removedAt: props.removedAt,
        deletedAt: props.deletedAt,
      });
      await this.invitationRepository.revokePendingByMembership(dto.staffId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'RemoveStaffService: removal failed');
      throw new InternalServerError('Failed to remove staff member. Please try again.');
    }

    // Release list assignments (no-op stub until US-005 — OQ-1).
    await this.listAssignmentPort.unassignAll(dto.staffId);

    // Revoke the removed member's active sessions (edge case #1).
    await this.sessionRevocation.revokeAllForUser(record.userId, 'staff_removed', correlationId);

    // Audit (canonical path; J handles session revocation only).
    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.performedByUserId,
      performedByRole: dto.performedByRole,
      action: AuditAction.STAFF_REMOVED,
      entityType: 'staff',
      entityId: dto.staffId,
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    this.logger.info(
      { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString(), correlationId },
      'RemoveStaffService: staff removed'
    );

    const props = entity.getProps();
    return {
      staffId: dto.staffId.toString(),
      status: props.status,
      removedAt: props.removedAt?.toISOString() ?? null,
    };
  }
}
