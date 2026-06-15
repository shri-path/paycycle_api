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
}
