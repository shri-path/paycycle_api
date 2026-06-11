import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { StaffNotAssignableError, SupplyListNotFoundError } from '../../domain/supply-list.errors';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { buildSupplyListDto } from '../../database/supply-list-projection';
import { StaffDirectoryPort } from '../../ports/staff-directory.port';
import { DeliveryStatsPort } from '../../ports/delivery-stats.port';
import { SupplyListDto } from '../../supply-list.types';

export interface AssignStaffRequestDto {
  vendorId: bigint;
  listId: bigint;
  staffId: bigint;
  isPrimary: boolean;
  actorUserId: bigint;
  actorRole: string;
  ip: string | null;
  userAgent: string | null;
}

export class AssignStaffService {
  constructor(
    private readonly repository: ISupplyListRepository,
    private readonly staffDirectory: StaffDirectoryPort,
    private readonly deliveryStats: DeliveryStatsPort,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: assign a staff member to a list; demote others if primary. */
  async execute(dto: AssignStaffRequestDto): Promise<SupplyListDto> {
    const correlationId = crypto.randomUUID();

    const record = await this.repository.findById(dto.listId, dto.vendorId);
    if (!record || record.deletedAt !== null) {
      throw new SupplyListNotFoundError();
    }

    const membership = await this.staffDirectory.findActiveMembership(dto.vendorId, dto.staffId);
    if (!membership) {
      throw new StaffNotAssignableError('Staff member is disabled or not found in this vendor');
    }

    try {
      await this.repository.assignStaff(dto.listId, dto.staffId, dto.isPrimary, dto.actorUserId);
      if (dto.isPrimary) {
        await this.repository.demoteOtherPrimaries(dto.listId, dto.staffId);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'AssignStaffService: assign failed');
      throw new InternalServerError('Failed to assign staff. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.actorUserId,
      performedByRole: dto.actorRole,
      action: AuditAction.LIST_STAFF_ASSIGNED,
      entityType: 'supply_list',
      entityId: dto.listId,
      metadata: { staffId: dto.staffId.toString(), isPrimary: dto.isPrimary },
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    const reloaded = await this.repository.findById(dto.listId, dto.vendorId);
    if (!reloaded) throw new InternalServerError('Failed to reload supply list.');
    return buildSupplyListDto(reloaded, this.repository, this.deliveryStats);
  }
}
