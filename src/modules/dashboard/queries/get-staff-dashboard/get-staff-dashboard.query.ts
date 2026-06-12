/**
 * GetStaffDashboardQuery — Query (read-only, no side effects).
 * Financial-free by construction.
 * Auth rule:
 *   - owner → may view any staffId in the vendor
 *   - staff → may only view own staffId (403 otherwise)
 *   - staffId not in vendor → 404
 */
import { ForbiddenError, NotFoundError } from '@/common/errors/app-error';
import { IDashboardReadRepository } from '../../database/dashboard-read.repository.port';
import { DashboardMapper } from '../../dashboard.mapper';
import { StaffDashboardDto } from '../../dashboard.types';

export class GetStaffDashboardQuery {
  constructor(private readonly readRepo: IDashboardReadRepository) {}

  async execute(
    vendorId: bigint,
    targetStaffId: bigint,
    callerRole: 'owner' | 'staff',
    callerStaffId: bigint
  ): Promise<StaffDashboardDto> {
    // Staff may only view their own dashboard
    if (callerRole === 'staff' && callerStaffId !== targetStaffId) {
      throw new ForbiddenError('Staff members can only view their own dashboard');
    }

    // Verify targetStaffId exists in this vendor
    const exists = await this.readRepo.staffExistsInVendor(vendorId, targetStaffId);
    if (!exists) {
      throw new NotFoundError('Staff member not found in this vendor');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [staffName, assignedLists] = await Promise.all([
      this.readRepo.staffName(vendorId, targetStaffId),
      this.readRepo.todayListProgress(vendorId, today, targetStaffId),
    ]);

    return DashboardMapper.toStaffDashboardDto({
      date: today,
      staffName,
      assignedLists,
    });
  }
}
