import { SupplyFrequency as PrismaSupplyFrequency } from '@prisma/client';
import { SupplyListEntity } from '../domain/supply-list.entity';
import {
  ScheduleRuleProps,
  StaffAssignmentProps,
  SupplyFrequency,
} from '../domain/supply-list.types';
import {
  AssignedStaffDto,
  MonthStatsDto,
  SupplyListDto,
  SupplyListListDto,
  TodayStatsDto,
} from '../supply-list.types';
import { AssignedStaffInfo, SupplyListRecord } from './supply-list.repository.port';

export interface SupplyListProjections {
  assignedStaff: AssignedStaffInfo[];
  customerCount: number;
  todayStats: TodayStatsDto;
  monthStats?: MonthStatsDto;
  includePhone?: boolean;
}

function toNumber(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

export class SupplyListMapper {
  // === Persistence → Domain ===

  static toDomain(record: SupplyListRecord): SupplyListEntity {
    const staff: StaffAssignmentProps[] = record.staff.map((s) => ({
      vendorUserId: s.vendorUserId,
      isPrimary: s.isPrimary,
      assignedByUserId: s.assignedByUserId,
      assignedAt: s.assignedAt,
    }));
    const schedule: ScheduleRuleProps[] = record.schedule.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      dayOfMonth: s.dayOfMonth,
    }));

    return SupplyListEntity.reconstitute({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        vendorId: record.vendorId,
        name: record.name,
        supplyType: record.supplyType,
        unit: record.unit,
        defaultQuantity: toNumber(record.defaultQuantity),
        ratePerUnit: toNumber(record.ratePerUnit),
        startTime: record.startTime,
        // Prisma enum → domain enum (identical string values, safe cast).
        frequency: record.frequency as unknown as SupplyFrequency,
        isActive: record.isActive,
        deletedAt: record.deletedAt,
        staff,
        schedule,
      },
    });
  }

  // === Domain → Response (WHITELIST) ===

  private static frequencyDays(entity: SupplyListEntity): number[] {
    const props = entity.getProps();
    if (props.frequency === SupplyFrequency.WEEKLY) {
      return props.schedule
        .map((r) => r.dayOfWeek)
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b);
    }
    if (props.frequency === SupplyFrequency.MONTHLY) {
      return props.schedule
        .map((r) => r.dayOfMonth)
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b);
    }
    return [];
  }

  private static assignedStaffDtos(
    assigned: AssignedStaffInfo[],
    includePhone: boolean
  ): AssignedStaffDto[] {
    return assigned.map((s) => ({
      staffId: s.vendorUserId.toString(),
      staffName: s.name,
      ...(includePhone ? { phoneNumber: s.phone } : {}),
      isPrimary: s.isPrimary,
    }));
  }

  static toListResponse(
    entity: SupplyListEntity,
    projections: SupplyListProjections
  ): SupplyListListDto {
    const props = entity.getProps();
    return {
      id: props.id.toString(),
      name: props.name,
      supplyType: props.supplyType,
      unit: props.unit,
      defaultQuantity: props.defaultQuantity,
      defaultRatePerUnit: props.ratePerUnit,
      startTime: props.startTime,
      // Domain enum → Prisma enum on the response DTO (identical string values).
      frequency: props.frequency as unknown as PrismaSupplyFrequency,
      status: props.isActive ? 'active' : 'archived',
      assignedStaff: SupplyListMapper.assignedStaffDtos(
        projections.assignedStaff,
        projections.includePhone ?? false
      ),
      customerCount: projections.customerCount,
      todayStats: projections.todayStats,
      // NEVER expose deletedAt.
    };
  }

  static toResponse(
    entity: SupplyListEntity,
    projections: SupplyListProjections & { monthStats: MonthStatsDto }
  ): SupplyListDto {
    return {
      ...SupplyListMapper.toListResponse(entity, projections),
      frequencyDays: SupplyListMapper.frequencyDays(entity),
      monthStats: projections.monthStats,
    };
  }
}
