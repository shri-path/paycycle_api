import { Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ActiveSubscriptionForGeneration } from './delivery.repository.port';

/** A supply list with its display fields and assigned staff. */
export interface SupplyListInfo {
  id: bigint;
  name: string;
  unit: string;
  startTime: string | null;
  staff: Array<{ staffId: bigint; name: string | null }>;
}

/** A resolved subscription on a list for a customer. */
export interface SubscriptionRef {
  subscriptionId: bigint;
  supplyListId: bigint;
}

/** Customer display info. */
export interface CustomerDisplay {
  id: bigint;
  name: string | null;
  address: string | null;
  phoneNumber: string | null;
}

/**
 * Read adapter over the supply-list / customer / staff contexts (US-005/US-008).
 * Delivery context owns no list/customer data — it reads through this ACL.
 */
export class DeliveryReader {
  private db(tx?: PrismaTransaction) {
    return tx ?? prisma;
  }

  /** Lists for a vendor (active, non-archived), optionally restricted to ids. */
  async getSupplyLists(
    vendorId: bigint,
    listIds?: bigint[],
    tx?: PrismaTransaction
  ): Promise<SupplyListInfo[]> {
    const where: Prisma.SupplyListWhereInput = { vendorId, deletedAt: null };
    if (listIds !== undefined) where.id = { in: listIds };
    const rows = await this.db(tx).supplyList.findMany({
      where,
      select: {
        id: true,
        name: true,
        unit: true,
        startTime: true,
        staff: {
          select: { vendorUser: { select: { id: true, user: { select: { name: true } } } } },
        },
      },
      orderBy: { startTime: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      startTime: r.startTime,
      staff: r.staff.map((s) => ({ staffId: s.vendorUser.id, name: s.vendorUser.user.name })),
    }));
  }

  /** A single list, tenant-scoped. Null when missing/archived/other-tenant. */
  async getSupplyList(
    vendorId: bigint,
    listId: bigint,
    tx?: PrismaTransaction
  ): Promise<SupplyListInfo | null> {
    const lists = await this.getSupplyLists(vendorId, [listId], tx);
    return lists[0] ?? null;
  }

  /** Supply list ids a staff membership is assigned to (active lists only). */
  async getAssignedListIds(staffMembershipId: bigint, tx?: PrismaTransaction): Promise<bigint[]> {
    const rows = await this.db(tx).supplyListStaff.findMany({
      where: { vendorUserId: staffMembershipId, supplyList: { isActive: true, deletedAt: null } },
      select: { supplyListId: true },
    });
    return rows.map((r) => r.supplyListId);
  }

  async isAssignedToList(
    staffMembershipId: bigint,
    listId: bigint,
    tx?: PrismaTransaction
  ): Promise<boolean> {
    const row = await this.db(tx).supplyListStaff.findFirst({
      where: { vendorUserId: staffMembershipId, supplyListId: listId },
      select: { id: true },
    });
    return row !== null;
  }

  /** Resolve a customer's non-ended subscriptions on the given lists. */
  async resolveSubscriptions(
    vendorId: bigint,
    customerId: bigint,
    supplyListIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<SubscriptionRef[]> {
    const rows = await this.db(tx).supplyListCustomer.findMany({
      where: {
        vendorId,
        customerId,
        supplyListId: { in: supplyListIds },
        endDate: null,
        deletedAt: null,
      },
      select: { id: true, supplyListId: true },
    });
    return rows.map((r) => ({ subscriptionId: r.id, supplyListId: r.supplyListId }));
  }

  /** Non-ended subscription ids across the given lists (for staff leave scoping). */
  async resolveSubscriptionsForLists(
    vendorId: bigint,
    supplyListIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<bigint[]> {
    if (supplyListIds.length === 0) return [];
    const rows = await this.db(tx).supplyListCustomer.findMany({
      where: {
        vendorId,
        supplyListId: { in: supplyListIds },
        endDate: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Batch customer display info keyed by customerId string. */
  async getCustomerDisplay(
    vendorId: bigint,
    customerIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<Map<string, CustomerDisplay>> {
    const map = new Map<string, CustomerDisplay>();
    if (customerIds.length === 0) return map;
    const rows = await this.db(tx).vendorCustomer.findMany({
      where: { vendorId, customerId: { in: customerIds }, deletedAt: null },
      select: {
        customerId: true,
        customer: { select: { name: true, phone: true, address: true } },
      },
    });
    for (const r of rows) {
      map.set(r.customerId.toString(), {
        id: r.customerId,
        name: r.customer.name,
        address: r.customer.address,
        phoneNumber: r.customer.phone,
      });
    }
    return map;
  }

  /** Customer ids → customer display for a set of subscriptions. */
  async getSubscriptionCustomers(
    supplyListCustomerIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<Map<string, { customerId: bigint; name: string | null; listName: string }>> {
    const map = new Map<string, { customerId: bigint; name: string | null; listName: string }>();
    if (supplyListCustomerIds.length === 0) return map;
    const rows = await this.db(tx).supplyListCustomer.findMany({
      where: { id: { in: supplyListCustomerIds } },
      select: {
        id: true,
        customer: { select: { name: true, id: true } },
        supplyList: { select: { name: true } },
      },
    });
    for (const r of rows) {
      map.set(r.id.toString(), {
        customerId: r.customer.id,
        name: r.customer.name,
        listName: r.supplyList.name,
      });
    }
    return map;
  }

  /** Map subscriptionId → customerId for a set of supplies. */
  async getSubscriptionCustomerIds(
    supplyListCustomerIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<Map<string, bigint>> {
    const map = new Map<string, bigint>();
    if (supplyListCustomerIds.length === 0) return map;
    const rows = await this.db(tx).supplyListCustomer.findMany({
      where: { id: { in: supplyListCustomerIds } },
      select: { id: true, customerId: true },
    });
    for (const r of rows) map.set(r.id.toString(), r.customerId);
    return map;
  }

  /** Other active list names per customer (for the otherLists field). */
  async getOtherListNames(
    vendorId: bigint,
    customerIds: bigint[],
    excludeListId: bigint,
    tx?: PrismaTransaction
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (customerIds.length === 0) return map;
    const rows = await this.db(tx).supplyListCustomer.findMany({
      where: {
        vendorId,
        customerId: { in: customerIds },
        supplyListId: { not: excludeListId },
        endDate: null,
        deletedAt: null,
        supplyList: { isActive: true, deletedAt: null },
      },
      select: { customerId: true, supplyList: { select: { name: true } } },
    });
    for (const r of rows) {
      const list = map.get(r.customerId.toString()) ?? [];
      list.push(r.supplyList.name);
      map.set(r.customerId.toString(), list);
    }
    return map;
  }

  /** Display info for users who marked deliveries, keyed by userId string. */
  async getMarkerNames(
    userIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (userIds.length === 0) return map;
    const rows = await this.db(tx).user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) map.set(r.id.toString(), r.name);
    return map;
  }

  /**
   * Active subscriptions for a vendor that should be considered for generation
   * on a given date (start window respected; ended excluded).
   */
  async getActiveSubscriptionsForGeneration(
    vendorId: bigint,
    date: Date,
    tx?: PrismaTransaction
  ): Promise<ActiveSubscriptionForGeneration[]> {
    const rows = await this.db(tx).supplyListCustomer.findMany({
      where: {
        vendorId,
        isActive: true,
        endDate: null,
        deletedAt: null,
        OR: [{ startDate: null }, { startDate: { lte: date } }],
        supplyList: { isActive: true, deletedAt: null },
      },
      select: {
        id: true,
        vendorId: true,
        supplyListId: true,
        customerId: true,
        customQuantity: true,
        customRatePerUnit: true,
        startDate: true,
        endDate: true,
        supplyList: {
          select: {
            unit: true,
            defaultQuantity: true,
            ratePerUnit: true,
            frequency: true,
            schedule: { select: { dayOfWeek: true, dayOfMonth: true } },
          },
        },
      },
    });

    return rows
      .map((r): ActiveSubscriptionForGeneration | null => {
        const qty = r.customQuantity ?? r.supplyList.defaultQuantity;
        const rate = r.customRatePerUnit ?? r.supplyList.ratePerUnit;
        if (qty === null || rate === null) return null;
        const days = r.supplyList.schedule
          .map((s) => s.dayOfWeek ?? s.dayOfMonth)
          .filter((d): d is number => d !== null);
        return {
          subscriptionId: r.id,
          vendorId: r.vendorId,
          supplyListId: r.supplyListId,
          customerId: r.customerId,
          quantity: Number(qty.toString()),
          unit: r.supplyList.unit,
          ratePerUnit: Number(rate.toString()),
          frequency: r.supplyList.frequency,
          frequencyDays: days,
          startDate: r.startDate,
          endDate: r.endDate,
        };
      })
      .filter((r): r is ActiveSubscriptionForGeneration => r !== null);
  }

  /** Vendor ids with at least one active subscription (for the cron fan-out). */
  async getVendorIdsWithActiveSubscriptions(tx?: PrismaTransaction): Promise<bigint[]> {
    const rows = await this.db(tx).supplyListCustomer.findMany({
      where: { isActive: true, endDate: null, deletedAt: null },
      select: { vendorId: true },
      distinct: ['vendorId'],
    });
    return rows.map((r) => r.vendorId);
  }
}
