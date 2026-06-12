import { prisma } from '@/infrastructure/database/prisma.client';

/** Customer + list display info resolved for a delivery (daily_supply) entity. */
export interface DeliveryEntityRefs {
  customerId: bigint;
  customerName: string | null;
  supplyListId: bigint;
  supplyListName: string | null;
}

/**
 * Read ACL over the user / customer / supply-list contexts. The audit context
 * owns none of this data — it resolves display names in batches (N+1-free) and
 * never imports another module's domain classes.
 */
export class AuditReader {
  /** userId → display name (null when user missing). */
  async getUserNames(userIds: bigint[]): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    const ids = [...new Set(userIds.map((id) => id.toString()))].map((s) => BigInt(s));
    if (ids.length === 0) return map;
    const rows = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    for (const r of rows) map.set(r.id.toString(), r.name);
    return map;
  }

  /** customerId → display name for a vendor (tenant-scoped). */
  async getCustomerNames(
    vendorId: bigint,
    customerIds: bigint[]
  ): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    const ids = [...new Set(customerIds.map((id) => id.toString()))].map((s) => BigInt(s));
    if (ids.length === 0) return map;
    const rows = await prisma.vendorCustomer.findMany({
      where: { vendorId, customerId: { in: ids }, deletedAt: null },
      select: { customerId: true, customer: { select: { name: true } } },
    });
    for (const r of rows) map.set(r.customerId.toString(), r.customer.name);
    return map;
  }

  /**
   * For audit rows whose entityType === 'daily_supply', resolve the owning
   * customer and supply list. Keyed by dailySupply id string.
   */
  async getDeliveryRefs(dailySupplyIds: bigint[]): Promise<Map<string, DeliveryEntityRefs>> {
    const map = new Map<string, DeliveryEntityRefs>();
    const ids = [...new Set(dailySupplyIds.map((id) => id.toString()))].map((s) => BigInt(s));
    if (ids.length === 0) return map;
    const rows = await prisma.dailySupply.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        supplyListId: true,
        supplyList: { select: { name: true } },
        subscription: {
          select: { customerId: true, customer: { select: { name: true } } },
        },
      },
    });
    for (const r of rows) {
      map.set(r.id.toString(), {
        customerId: r.subscription.customerId,
        customerName: r.subscription.customer.name,
        supplyListId: r.supplyListId,
        supplyListName: r.supplyList.name,
      });
    }
    return map;
  }

  /** supplyListId → name for a vendor (tenant-scoped). */
  async getSupplyListNames(
    vendorId: bigint,
    listIds: bigint[]
  ): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    const ids = [...new Set(listIds.map((id) => id.toString()))].map((s) => BigInt(s));
    if (ids.length === 0) return map;
    const rows = await prisma.supplyList.findMany({
      where: { vendorId, id: { in: ids } },
      select: { id: true, name: true },
    });
    for (const r of rows) map.set(r.id.toString(), r.name);
    return map;
  }
}
