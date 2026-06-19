/**
 * Prisma adapter for CustomerCountPort.
 * Reads from vendor_customers — does NOT import customer module internals.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { ICustomerCountPort } from '../ports/customer-count.port';

export class CustomerCountAdapter implements ICustomerCountPort {
  async activeCustomerCount(vendorId: bigint): Promise<number> {
    return prisma.vendorCustomer.count({
      where: {
        vendorId,
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
  }

  async customersAddedWithinDays(vendorId: bigint, days: number): Promise<number> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return prisma.vendorCustomer.count({
      where: {
        vendorId,
        status: 'ACTIVE',
        deletedAt: null,
        createdAt: { gte: since },
      },
    });
  }

  async activeCustomerCountByVendor(vendorIds: bigint[]): Promise<Map<bigint, number>> {
    const result = new Map<bigint, number>();
    // Seed every requested vendor with 0 so callers always get a value.
    for (const id of vendorIds) result.set(id, 0);
    if (vendorIds.length === 0) return result;

    const groups = await prisma.vendorCustomer.groupBy({
      by: ['vendorId'],
      where: {
        vendorId: { in: vendorIds },
        status: 'ACTIVE',
        deletedAt: null,
      },
      _count: { _all: true },
    });

    for (const g of groups) {
      result.set(g.vendorId, g._count._all);
    }
    return result;
  }
}
