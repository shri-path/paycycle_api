/**
 * CustomerLookupAdapter — ACL adapter reading customer data from the DB.
 * Does not import any Customer module classes (ACL boundary).
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { ICustomerLookupPort } from '../ports/customer-lookup.port';

export class CustomerLookupAdapter implements ICustomerLookupPort {
  async listRosterForList(
    vendorId: bigint,
    supplyListId: bigint,
    serviceDate: Date
  ): Promise<{ id: bigint; name: string }[]> {
    // Get active subscriptions for the list on the given service date
    const rows = await prisma.supplyListCustomer.findMany({
      where: {
        vendorId,
        supplyListId,
        isActive: true,
        deletedAt: null,
        OR: [{ startDate: null }, { startDate: { lte: serviceDate } }],
        AND: [
          {
            OR: [{ endDate: null }, { endDate: { gte: serviceDate } }],
          },
        ],
      },
      select: {
        customerId: true,
        customer: {
          select: { id: true, name: true },
        },
      },
    });

    return rows
      .filter((r) => r.customer !== null)
      .map((r) => ({
        id: r.customer.id,
        name: r.customer.name ?? 'Unknown',
      }));
  }

  async getCustomer(
    customerId: bigint,
    vendorId: bigint
  ): Promise<{ id: bigint; name: string } | null> {
    const row = await prisma.customer.findFirst({
      where: {
        id: customerId,
        deletedAt: null,
        vendorCustomers: {
          some: { vendorId, deletedAt: null },
        },
      },
      select: { id: true, name: true },
    });
    if (!row) return null;
    return { id: row.id, name: row.name ?? 'Unknown' };
  }
}
