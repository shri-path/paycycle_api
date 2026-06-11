import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError, NotFoundError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { SupplyListNotFoundError } from '../../domain/supply-list.errors';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { buildSupplyListDto } from '../../database/supply-list-projection';
import { DeliveryStatsPort } from '../../ports/delivery-stats.port';
import { SupplyListDto } from '../../supply-list.types';

export interface UnassignStaffRequestDto {
  vendorId: bigint;
  listId: bigint;
  staffId: bigint;
  actorUserId: bigint;
  actorRole: string;
  ip: string | null;
  userAgent: string | null;
}

export class UnassignStaffService {
  constructor(
    private readonly repository: ISupplyListRepository,
    private readonly deliveryStats: DeliveryStatsPort,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: remove a staff member's assignment from a list (no primary promotion). */
  async execute(dto: UnassignStaffRequestDto): Promise<SupplyListDto> {
    const correlationId = crypto.randomUUID();

    const record = await this.repository.findById(dto.listId, dto.vendorId);
    if (!record || record.deletedAt !== null) {
      throw new SupplyListNotFoundError();
    }
    if (!record.staff.some((s) => s.vendorUserId === dto.staffId)) {
      throw new NotFoundError('Assignment not found');
    }

    try {
      await this.repository.unassignStaff(dto.listId, dto.staffId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'UnassignStaffService: unassign failed');
      throw new InternalServerError('Failed to unassign staff. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.actorUserId,
      performedByRole: dto.actorRole,
      action: AuditAction.LIST_STAFF_UNASSIGNED,
      entityType: 'supply_list',
      entityId: dto.listId,
      metadata: { staffId: dto.staffId.toString() },
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    const reloaded = await this.repository.findById(dto.listId, dto.vendorId);
    if (!reloaded) throw new InternalServerError('Failed to reload supply list.');
    return buildSupplyListDto(reloaded, this.repository, this.deliveryStats);
  }
}
