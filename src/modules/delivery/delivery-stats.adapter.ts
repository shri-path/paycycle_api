import { prisma } from '@/infrastructure/database/prisma.client';
import { DeliveryStatsPort } from '@/modules/supply-list/ports/delivery-stats.port';
import { MonthStatsDto, TodayStatsDto } from '@/modules/supply-list/supply-list.types';

/**
 * Real DeliveryStatsPort adapter (US-006) — replaces the zero stub the
 * supply-list module shipped with. Reads `daily_supplies` directly to roll up
 * per-list today / month statistics.
 */
export class DeliveryStatsAdapter implements DeliveryStatsPort {
  async getTodayStats(supplyListId: bigint, date: Date): Promise<TodayStatsDto> {
    const serviceDate = normalize(date);
    const rows = await prisma.dailySupply.groupBy({
      by: ['status'],
      where: { supplyListId, serviceDate },
      _count: { _all: true },
      _sum: { quantity: true },
    });

    let delivered = 0;
    let onLeave = 0;
    let pending = 0;
    let totalQuantity = 0;
    for (const r of rows) {
      const count = r._count._all;
      const qty = r._sum.quantity ? Number(r._sum.quantity.toString()) : 0;
      if (r.status === 'DELIVERED' || r.status === 'AUTO_MARKED') {
        delivered += count;
        totalQuantity += qty;
      } else if (r.status === 'LEAVE') {
        onLeave += count;
      } else if (r.status === 'PENDING') {
        pending += count;
      }
    }

    return {
      date: serviceDate.toISOString().slice(0, 10),
      delivered,
      onLeave,
      pending,
      totalQuantity,
    };
  }

  async getMonthStats(supplyListId: bigint, month: Date): Promise<MonthStatsDto> {
    const from = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));

    const agg = await prisma.dailySupply.aggregate({
      where: {
        supplyListId,
        serviceDate: { gte: from, lte: to },
        status: { in: ['DELIVERED', 'AUTO_MARKED'] },
      },
      _sum: { quantity: true, finalAmount: true },
    });

    const distinctDays = await prisma.dailySupply.findMany({
      where: {
        supplyListId,
        serviceDate: { gte: from, lte: to },
        status: { in: ['DELIVERED', 'AUTO_MARKED'] },
      },
      select: { serviceDate: true },
      distinct: ['serviceDate'],
    });

    return {
      month: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`,
      daysCompleted: distinctDays.length,
      totalQuantity: agg._sum.quantity ? Number(agg._sum.quantity.toString()) : 0,
      revenue: agg._sum.finalAmount ? Number(agg._sum.finalAmount.toString()) : 0,
    };
  }
}

function normalize(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
