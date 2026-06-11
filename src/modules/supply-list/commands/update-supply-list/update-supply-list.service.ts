import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { DuplicateListNameError, SupplyListNotFoundError } from '../../domain/supply-list.errors';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { SupplyListMapper } from '../../database/supply-list.mapper';
import { SupplyFrequency, UpdateSupplyListPatch } from '../../domain/supply-list.types';
import { DeliveryStatsPort } from '../../ports/delivery-stats.port';
import { SupplyListDto } from '../../supply-list.types';

export interface UpdateSupplyListRequestDto {
  vendorId: bigint;
  listId: bigint;
  actorUserId: bigint;
  actorRole: string;
  patch: {
    name?: string;
    supplyType?: string | null;
    unit?: string;
    defaultQuantity?: number | null;
    defaultRatePerUnit?: number | null;
    startTime?: string | null;
    frequency?: SupplyFrequency;
    frequencyDays?: number[];
  };
  ip: string | null;
  userAgent: string | null;
}

export class UpdateSupplyListService {
  constructor(
    private readonly repository: ISupplyListRepository,
    private readonly deliveryStats: DeliveryStatsPort,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: update supply-list details (price edit never touches overrides). */
  async execute(dto: UpdateSupplyListRequestDto): Promise<SupplyListDto> {
    const correlationId = crypto.randomUUID();

    const record = await this.repository.findById(dto.listId, dto.vendorId);
    if (!record || record.deletedAt !== null) {
      throw new SupplyListNotFoundError();
    }

    // OQ-5 — re-check uniqueness if the name changes.
    if (
      dto.patch.name !== undefined &&
      dto.patch.name.trim().toLowerCase() !== record.name.toLowerCase()
    ) {
      const duplicate = await this.repository.findActiveByName(dto.vendorId, dto.patch.name.trim());
      if (duplicate && duplicate.id !== record.id) {
        throw new DuplicateListNameError();
      }
    }

    const entity = SupplyListMapper.toDomain(record);
    const patch: UpdateSupplyListPatch = {
      ...(dto.patch.name !== undefined ? { name: dto.patch.name } : {}),
      ...(dto.patch.supplyType !== undefined ? { supplyType: dto.patch.supplyType } : {}),
      ...(dto.patch.unit !== undefined ? { unit: dto.patch.unit } : {}),
      ...(dto.patch.defaultQuantity !== undefined
        ? { defaultQuantity: dto.patch.defaultQuantity }
        : {}),
      ...(dto.patch.defaultRatePerUnit !== undefined
        ? { ratePerUnit: dto.patch.defaultRatePerUnit }
        : {}),
      ...(dto.patch.startTime !== undefined ? { startTime: dto.patch.startTime } : {}),
      ...(dto.patch.frequency !== undefined ? { frequency: dto.patch.frequency } : {}),
      ...(dto.patch.frequencyDays !== undefined ? { scheduleDays: dto.patch.frequencyDays } : {}),
    };

    entity.updateDetails(patch, correlationId);

    let updated;
    try {
      updated = await this.repository.updateDetails(entity);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'UpdateSupplyListService: update failed');
      throw new InternalServerError('Failed to update supply list. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.actorUserId,
      performedByRole: dto.actorRole,
      action: AuditAction.LIST_UPDATED,
      entityType: 'supply_list',
      entityId: dto.listId,
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    const result = SupplyListMapper.toDomain(updated);
    const assignedStaff = await this.repository.assignedStaffFor([updated.id]);
    const customerCount = await this.repository.countActiveCustomers([updated.id]);
    const today = new Date();
    const [todayStats, monthStats] = await Promise.all([
      this.deliveryStats.getTodayStats(updated.id, today),
      this.deliveryStats.getMonthStats(updated.id, today),
    ]);

    return SupplyListMapper.toResponse(result, {
      assignedStaff: assignedStaff.get(updated.id.toString()) ?? [],
      customerCount: customerCount.get(updated.id.toString()) ?? 0,
      todayStats,
      monthStats,
      includePhone: true,
    });
  }
}
