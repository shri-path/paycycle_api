import { SupplyListMapper } from './supply-list.mapper';
import { ISupplyListRepository, SupplyListRecord } from './supply-list.repository.port';
import { DeliveryStatsPort } from '../ports/delivery-stats.port';
import { SupplyListDto } from '../supply-list.types';

/**
 * Builds a full SupplyListDto from a record by batch-loading assignedStaff,
 * customerCount, and (stubbed) delivery stats. Shared by the command services
 * that return the updated list.
 */
export async function buildSupplyListDto(
  record: SupplyListRecord,
  repository: ISupplyListRepository,
  deliveryStats: DeliveryStatsPort,
  includePhone = true
): Promise<SupplyListDto> {
  const entity = SupplyListMapper.toDomain(record);
  const [assignedStaff, customerCount] = await Promise.all([
    repository.assignedStaffFor([record.id]),
    repository.countActiveCustomers([record.id]),
  ]);
  const today = new Date();
  const [todayStats, monthStats] = await Promise.all([
    deliveryStats.getTodayStats(record.id, today),
    deliveryStats.getMonthStats(record.id, today),
  ]);
  return SupplyListMapper.toResponse(entity, {
    assignedStaff: assignedStaff.get(record.id.toString()) ?? [],
    customerCount: customerCount.get(record.id.toString()) ?? 0,
    todayStats,
    monthStats,
    includePhone,
  });
}
