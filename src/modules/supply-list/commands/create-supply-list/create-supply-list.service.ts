import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { SupplyListEntity } from '../../domain/supply-list.entity';
import { SupplyFrequency } from '../../domain/supply-list.types';
import { DuplicateListNameError, StaffNotAssignableError } from '../../domain/supply-list.errors';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { SupplyListMapper } from '../../database/supply-list.mapper';
import { StaffDirectoryPort } from '../../ports/staff-directory.port';
import { DeliveryStatsPort } from '../../ports/delivery-stats.port';
import { SupplyListDto } from '../../supply-list.types';

export interface CreateSupplyListRequestDto {
  vendorId: bigint;
  actorUserId: bigint;
  actorRole: string;
  name: string;
  supplyType: string | null;
  unit: string;
  defaultQuantity: number | null;
  defaultRatePerUnit: number | null;
  startTime: string | null;
  frequency: SupplyFrequency;
  frequencyDays: number[];
  staffIds: bigint[];
  primaryStaffId: bigint | null;
  ip: string | null;
  userAgent: string | null;
}

export class CreateSupplyListService {
  constructor(
    private readonly repository: ISupplyListRepository,
    private readonly staffDirectory: StaffDirectoryPort,
    private readonly deliveryStats: DeliveryStatsPort,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: create a supply list with optional staff assignments + schedule. */
  async execute(dto: CreateSupplyListRequestDto): Promise<SupplyListDto> {
    const correlationId = crypto.randomUUID();

    // OQ-5 — case-insensitive unique active name per vendor.
    const duplicate = await this.repository.findActiveByName(dto.vendorId, dto.name.trim());
    if (duplicate) {
      this.logger.warn(
        { vendorId: dto.vendorId.toString(), correlationId },
        'CreateSupplyListService: duplicate active list name'
      );
      throw new DuplicateListNameError();
    }

    // Validate every staff member is an ACTIVE vendor membership (edge #4).
    for (const staffId of dto.staffIds) {
      const membership = await this.staffDirectory.findActiveMembership(dto.vendorId, staffId);
      if (!membership) {
        throw new StaffNotAssignableError(
          `Staff member ${staffId.toString()} is not an active member of this vendor`
        );
      }
    }

    const entity = SupplyListEntity.create({
      vendorId: dto.vendorId,
      name: dto.name,
      supplyType: dto.supplyType,
      unit: dto.unit,
      defaultQuantity: dto.defaultQuantity,
      ratePerUnit: dto.defaultRatePerUnit,
      startTime: dto.startTime,
      frequency: dto.frequency,
      scheduleDays: dto.frequencyDays,
      staffIds: dto.staffIds,
      primaryStaffId: dto.primaryStaffId,
      createdByUserId: dto.actorUserId,
      correlationId,
    });

    let record;
    try {
      record = await this.repository.insert(entity);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'CreateSupplyListService: insert failed');
      throw new InternalServerError('Failed to create supply list. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.actorUserId,
      performedByRole: dto.actorRole,
      action: AuditAction.LIST_CREATED,
      entityType: 'supply_list',
      entityId: record.id,
      metadata: { name: dto.name, frequency: dto.frequency },
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    this.logger.info(
      { vendorId: dto.vendorId.toString(), listId: record.id.toString(), correlationId },
      'CreateSupplyListService: list created'
    );

    const created = SupplyListMapper.toDomain(record);
    const assignedStaff = await this.repository.assignedStaffFor([record.id]);
    const today = new Date();
    const [todayStats, monthStats] = await Promise.all([
      this.deliveryStats.getTodayStats(record.id, today),
      this.deliveryStats.getMonthStats(record.id, today),
    ]);

    return SupplyListMapper.toResponse(created, {
      assignedStaff: assignedStaff.get(record.id.toString()) ?? [],
      customerCount: 0,
      todayStats,
      monthStats,
      includePhone: true,
    });
  }
}
