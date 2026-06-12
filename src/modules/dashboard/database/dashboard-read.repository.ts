/**
 * DashboardReadRepository — Prisma adapter for IDashboardReadRepository.
 * Uses aggregate/groupBy queries. No N+1. Returns plain ReadModel rows.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import {
  CustomerBalanceRow,
  QuickStatsRow,
  ListProgressRow,
  ForecastSubscriptionRow,
  LeaveRow,
} from '../dashboard.types';
import { IDashboardReadRepository } from './dashboard-read.repository.port';

export class DashboardReadRepository implements IDashboardReadRepository {
  async monthlyRevenue(vendorId: bigint, monthStart: Date, monthEnd: Date): Promise<number> {
    const result = await prisma.dailySupply.aggregate({
      _sum: { finalAmount: true },
      where: {
        vendorId,
        status: { in: ['DELIVERED', 'AUTO_MARKED'] },
        serviceDate: { gte: monthStart, lte: monthEnd },
      },
    });
    return result._sum.finalAmount?.toNumber() ?? 0;
  }

  async monthlyCollected(vendorId: bigint, monthStart: Date, monthEnd: Date): Promise<number> {
    const result = await prisma.payment.aggregate({
      _sum: { amount: true },
      where: {
        vendorId,
        paymentDate: { gte: monthStart, lte: monthEnd },
      },
    });
    return result._sum.amount?.toNumber() ?? 0;
  }

  async customerBalances(vendorId: bigint): Promise<CustomerBalanceRow[]> {
    // One grouped query for delivered sums per customer
    const deliveredSums = await prisma.dailySupply.groupBy({
      by: ['supplyListCustomerId'],
      _sum: { finalAmount: true },
      where: {
        vendorId,
        status: { in: ['DELIVERED', 'AUTO_MARKED'] },
      },
    });

    // Get the subscription→customer mapping and customer details
    const subscriptionIds = deliveredSums
      .map((r) => r.supplyListCustomerId)
      .filter((id): id is bigint => id !== null);

    // Map subscriptionId to customerId
    const subscriptions = await prisma.supplyListCustomer.findMany({
      where: { id: { in: subscriptionIds }, vendorId },
      select: { id: true, customerId: true },
    });
    const subToCustomer = new Map<bigint, bigint>();
    for (const s of subscriptions) subToCustomer.set(s.id, s.customerId);

    // Aggregate delivered amounts by customerId
    const revenueByCustomer = new Map<bigint, number>();
    for (const row of deliveredSums) {
      const custId = subToCustomer.get(row.supplyListCustomerId);
      if (custId === undefined) continue;
      const current = revenueByCustomer.get(custId) ?? 0;
      revenueByCustomer.set(custId, current + (row._sum.finalAmount?.toNumber() ?? 0));
    }

    // One grouped query for payments per customer
    const paymentSums = await prisma.payment.groupBy({
      by: ['customerId'],
      _sum: { amount: true },
      _max: { paymentDate: true },
      where: { vendorId },
    });
    const paymentsByCustomer = new Map<bigint, { total: number; lastDate: Date | null }>();
    for (const row of paymentSums) {
      paymentsByCustomer.set(row.customerId, {
        total: row._sum.amount?.toNumber() ?? 0,
        lastDate: row._max.paymentDate,
      });
    }

    // All active customers in this vendor
    const allCustomerIds = [
      ...new Set([...revenueByCustomer.keys(), ...paymentsByCustomer.keys()]),
    ];

    if (allCustomerIds.length === 0) return [];

    const customers = await prisma.customer.findMany({
      where: {
        id: { in: allCustomerIds },
        deletedAt: null,
        vendorCustomers: {
          some: { vendorId, deletedAt: null },
        },
      },
      select: {
        id: true,
        name: true,
        creditLimit: true,
        paymentScore: true,
      },
    });

    // Oldest delivered serviceDate per customer (for daysOverdue approximation)
    const oldestDeliveries = await prisma.dailySupply.groupBy({
      by: ['supplyListCustomerId'],
      _min: { serviceDate: true },
      where: {
        vendorId,
        status: { in: ['DELIVERED', 'AUTO_MARKED'] },
        supplyListCustomerId: { in: subscriptionIds },
      },
    });
    const oldestBySubscription = new Map<bigint, Date>();
    for (const row of oldestDeliveries) {
      if (row._min.serviceDate) {
        oldestBySubscription.set(row.supplyListCustomerId, row._min.serviceDate);
      }
    }
    // Map to customerId
    const oldestByCustomer = new Map<bigint, Date>();
    for (const [subId, date] of oldestBySubscription) {
      const custId = subToCustomer.get(subId);
      if (custId === undefined) continue;
      const existing = oldestByCustomer.get(custId);
      if (!existing || date < existing) {
        oldestByCustomer.set(custId, date);
      }
    }

    return customers.map((c) => {
      const revenue = revenueByCustomer.get(c.id) ?? 0;
      const paid = paymentsByCustomer.get(c.id)?.total ?? 0;
      const lastPaymentDate = paymentsByCustomer.get(c.id)?.lastDate ?? null;
      const balance = Math.round(revenue - paid);
      return {
        customerId: c.id,
        customerName: c.name ?? 'Unknown',
        balance,
        creditLimit: c.creditLimit.toNumber(),
        paymentScore: c.paymentScore.toNumber(),
        lastPaymentDate,
        oldestUnpaidDate: balance > 0 ? (oldestByCustomer.get(c.id) ?? null) : null,
      };
    });
  }

  async quickStats(vendorId: bigint, today: Date): Promise<QuickStatsRow> {
    const [supplyListsCount, totalCustomers, activeStaff, conflictsToday] = await Promise.all([
      prisma.supplyList.count({
        where: { vendorId, isActive: true, deletedAt: null },
      }),
      prisma.vendorCustomer.count({
        where: { vendorId, status: 'ACTIVE', deletedAt: null },
      }),
      prisma.vendorUser.count({
        where: {
          vendorId,
          status: 'ACTIVE',
          deletedAt: null,
          role: { name: 'vendor_staff' },
        },
      }),
      // Conflicts: today's deliveries that were auto-marked AND have a manual override
      prisma.dailySupply.count({
        where: {
          vendorId,
          serviceDate: today,
          isAutoMarked: true,
          overrides: { some: {} },
        },
      }),
    ]);

    return { supplyListsCount, totalCustomers, activeStaff, conflictsToday };
  }

  async todayListProgress(
    vendorId: bigint,
    today: Date,
    staffVendorUserId?: bigint
  ): Promise<ListProgressRow[]> {
    const listWhere: Prisma.SupplyListWhereInput = {
      vendorId,
      isActive: true,
      deletedAt: null,
      ...(staffVendorUserId !== undefined
        ? { staff: { some: { vendorUserId: staffVendorUserId } } }
        : {}),
    };

    const lists = await prisma.supplyList.findMany({
      where: listWhere,
      select: {
        id: true,
        name: true,
        startTime: true,
        staff: {
          where: { isPrimary: true },
          take: 1,
          select: {
            vendorUser: {
              select: {
                user: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (lists.length === 0) return [];

    // Progress counts via groupBy
    const listIds = lists.map((l) => l.id);
    const progressRows = await prisma.dailySupply.groupBy({
      by: ['supplyListId', 'status'],
      _count: { id: true },
      where: {
        vendorId,
        serviceDate: today,
        supplyListId: { in: listIds },
        status: { not: 'CANCELLED' },
      },
    });

    type ProgressMap = { total: number; completed: number };
    const progressMap = new Map<bigint, ProgressMap>();
    for (const row of progressRows) {
      const existing: ProgressMap = progressMap.get(row.supplyListId) ?? { total: 0, completed: 0 };
      existing.total += row._count.id;
      if (row.status === 'DELIVERED' || row.status === 'AUTO_MARKED') {
        existing.completed += row._count.id;
      }
      progressMap.set(row.supplyListId, existing);
    }

    return lists.map((list) => {
      const progress = progressMap.get(list.id) ?? { total: 0, completed: 0 };
      const staffEntry = list.staff[0];
      const staffName = staffEntry?.vendorUser.user.name ?? null;
      return {
        listId: list.id,
        listName: list.name,
        startTime: list.startTime,
        staffName,
        total: progress.total,
        completed: progress.completed,
      };
    });
  }

  async activeSubscriptionsForForecast(
    vendorId: bigint,
    supplyType?: string
  ): Promise<ForecastSubscriptionRow[]> {
    const rows = await prisma.supplyListCustomer.findMany({
      where: {
        vendorId,
        isActive: true,
        deletedAt: null,
        ...(supplyType ? { supplyList: { supplyType } } : {}),
      },
      select: {
        id: true,
        supplyListId: true,
        customerId: true,
        customQuantity: true,
        startDate: true,
        endDate: true,
        supplyList: {
          select: {
            name: true,
            supplyType: true,
            unit: true,
            defaultQuantity: true,
            frequency: true,
          },
        },
      },
    });

    return rows.map((r) => ({
      subscriptionId: r.id,
      listId: r.supplyListId,
      listName: r.supplyList.name,
      supplyType: r.supplyList.supplyType,
      unit: r.supplyList.unit,
      defaultQuantity: r.supplyList.defaultQuantity?.toNumber() ?? 0,
      customQuantity: r.customQuantity?.toNumber() ?? null,
      customerId: r.customerId,
      startDate: r.startDate,
      endDate: r.endDate,
      frequency: r.supplyList.frequency,
    }));
  }

  async leavesInRange(vendorId: bigint, from: Date, to: Date): Promise<LeaveRow[]> {
    const rows = await prisma.leave.findMany({
      where: {
        subscription: { vendorId, deletedAt: null },
        startDate: { lte: to },
        endDate: { gte: from },
      },
      select: {
        supplyListCustomerId: true,
        startDate: true,
        endDate: true,
      },
    });

    return rows.map((r) => ({
      supplyListCustomerId: r.supplyListCustomerId,
      startDate: r.startDate,
      endDate: r.endDate,
    }));
  }

  async staffName(vendorId: bigint, staffVendorUserId: bigint): Promise<string | null> {
    const member = await prisma.vendorUser.findFirst({
      where: { id: staffVendorUserId, vendorId, deletedAt: null },
      select: { user: { select: { name: true } } },
    });
    return member?.user.name ?? null;
  }

  async staffExistsInVendor(vendorId: bigint, staffVendorUserId: bigint): Promise<boolean> {
    const count = await prisma.vendorUser.count({
      where: {
        id: staffVendorUserId,
        vendorId,
        deletedAt: null,
        status: 'ACTIVE',
      },
    });
    return count > 0;
  }
}
