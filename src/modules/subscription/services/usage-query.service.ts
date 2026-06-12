/**
 * UsageQueryService — live COUNT queries across vendor_customers, vendor_users, supply_lists.
 * Read-only; never hydrates the foreign aggregates.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { IUsageCounter, UsageAllResult } from '../ports/usage-counter.port';

export class UsageQueryService implements IUsageCounter {
  async countCustomers(vendorId: bigint): Promise<number> {
    return prisma.vendorCustomer.count({
      where: { vendorId, status: 'ACTIVE', deletedAt: null },
    });
  }

  async countStaff(vendorId: bigint): Promise<number> {
    // Count active, non-owner staff members (vendor_users with ACTIVE status)
    return prisma.vendorUser.count({
      where: {
        vendorId,
        status: 'ACTIVE',
        deletedAt: null,
        role: { name: 'vendor_staff' },
      },
    });
  }

  async countSupplyLists(vendorId: bigint): Promise<number> {
    return prisma.supplyList.count({
      where: { vendorId, isActive: true, deletedAt: null },
    });
  }

  async countAll(vendorId: bigint): Promise<UsageAllResult> {
    const [customers, staff, supplyLists] = await Promise.all([
      this.countCustomers(vendorId),
      this.countStaff(vendorId),
      this.countSupplyLists(vendorId),
    ]);
    return { customers, staff, supplyLists };
  }
}
