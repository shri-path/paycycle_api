/**
 * BulkRateWriterAdapter — Prisma implementation of BulkRateWriterPort.
 * Updates SupplyList.ratePerUnit and Subscription.customRatePerUnit (where null).
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { BulkRateWriterPort, SubscriptionTarget } from '../ports/bulk-rate-writer.port';

export class BulkRateWriterAdapter implements BulkRateWriterPort {
  async resolveSubscriptions(
    vendorId: bigint,
    mode: 'all' | 'specific',
    ids?: bigint[]
  ): Promise<SubscriptionTarget[]> {
    if (mode === 'all') {
      const subs = await prisma.supplyListCustomer.findMany({
        where: { vendorId, isActive: true, deletedAt: null },
        select: { id: true, supplyListId: true },
      });
      return subs.map((s) => ({ subscriptionId: s.id, supplyListId: s.supplyListId }));
    }

    if (!ids || ids.length === 0) return [];

    const subs = await prisma.supplyListCustomer.findMany({
      where: { id: { in: ids }, vendorId, isActive: true, deletedAt: null },
      select: { id: true, supplyListId: true },
    });
    return subs.map((s) => ({ subscriptionId: s.id, supplyListId: s.supplyListId }));
  }

  async updateListDefaultRate(listId: bigint, newRate: string, vendorId: bigint): Promise<void> {
    await prisma.supplyList.updateMany({
      where: { id: listId, vendorId, deletedAt: null },
      data: { ratePerUnit: newRate },
    });
  }

  async updateSubsWithoutCustomRate(subscriptionIds: bigint[], newRate: string): Promise<number> {
    if (subscriptionIds.length === 0) return 0;
    const result = await prisma.supplyListCustomer.updateMany({
      where: { id: { in: subscriptionIds }, customRatePerUnit: null },
      data: { ratePerUnit: newRate } as Record<string, unknown>,
    });
    return result.count;
  }

  async countSubsWithCustomRate(subscriptionIds: bigint[]): Promise<number> {
    if (subscriptionIds.length === 0) return 0;
    return prisma.supplyListCustomer.count({
      where: { id: { in: subscriptionIds }, customRatePerUnit: { not: null } },
    });
  }

  async getCustomerPhones(
    subscriptionIds: bigint[],
    vendorId: bigint
  ): Promise<{ subscriptionId: bigint; phone: string }[]> {
    if (subscriptionIds.length === 0) return [];
    const subs = await prisma.supplyListCustomer.findMany({
      where: { id: { in: subscriptionIds }, vendorId },
      include: { customer: { select: { phone: true } } },
    });
    return subs
      .filter((s) => s.customer?.phone)
      .map((s) => ({ subscriptionId: s.id, phone: s.customer.phone }));
  }
}
