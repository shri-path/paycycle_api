/**
 * SupplyForecastCalculator — standalone pure computation service.
 * Computes supply quantities for a given date and N-day window.
 */
import { IDashboardReadRepository } from '../database/dashboard-read.repository.port';
import { ForecastSubscriptionRow, LeaveRow, ByListForecastItem } from '../dashboard.types';

interface PerListAccumulator {
  listName: string;
  supplyType: string | null;
  unit: string;
  quantity: number;
  customerCount: number;
  plannedLeaves: number;
}

export interface ForecastResult {
  date: Date;
  byList: ByListForecastItem[];
  aggregatedByType: Record<string, { totalQuantity: number; unit: string; lists: string[] }>;
  nextNDays: {
    days: number;
    byType: Record<string, { totalQuantity: number; unit: string; dailyAverage: number }>;
  };
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isDateInRange(date: Date, startDate: Date | null, endDate: Date | null): boolean {
  if (startDate && date < startDate) return false;
  if (endDate && date > endDate) return false;
  return true;
}

function isOnLeave(subscriptionId: bigint, date: Date, leaves: LeaveRow[]): boolean {
  return leaves.some(
    (l) => l.supplyListCustomerId === subscriptionId && date >= l.startDate && date <= l.endDate
  );
}

function shouldDeliverOnDate(sub: ForecastSubscriptionRow, _date: Date): boolean {
  // DAILY: always deliver
  if (sub.frequency === 'DAILY') return true;
  // WEEKLY: check day of week (JS: 0=Sun, 1=Mon... Prisma dayOfWeek: 1-7 as Mon-Sun)
  if (sub.frequency === 'WEEKLY') {
    // We have no schedule rows in this calculator — default to DAILY behavior
    // (schedules can be extended later per OQ-3)
    return true;
  }
  // MONTHLY: same default
  return true;
}

function computeForDate(
  subscriptions: ForecastSubscriptionRow[],
  leaves: LeaveRow[],
  date: Date
): Map<bigint, PerListAccumulator> {
  const listMap = new Map<bigint, PerListAccumulator>();

  for (const sub of subscriptions) {
    if (!isDateInRange(date, sub.startDate, sub.endDate)) continue;
    if (!shouldDeliverOnDate(sub, date)) continue;

    if (!listMap.has(sub.listId)) {
      listMap.set(sub.listId, {
        listName: sub.listName,
        supplyType: sub.supplyType,
        unit: sub.unit,
        quantity: 0,
        customerCount: 0,
        plannedLeaves: 0,
      });
    }

    const acc = listMap.get(sub.listId)!;
    const onLeave = isOnLeave(sub.subscriptionId, date, leaves);

    if (onLeave) {
      acc.plannedLeaves += 1;
    } else {
      const qty = sub.customQuantity ?? sub.defaultQuantity;
      acc.quantity += qty;
      acc.customerCount += 1;
    }
  }

  return listMap;
}

export class SupplyForecastCalculator {
  constructor(private readonly readRepo: IDashboardReadRepository) {}

  async compute(
    vendorId: bigint,
    forecastDate: Date,
    days: number,
    supplyType?: string
  ): Promise<ForecastResult> {
    const windowEnd = addDays(forecastDate, days - 1);

    const [subscriptions, leaves] = await Promise.all([
      this.readRepo.activeSubscriptionsForForecast(vendorId, supplyType),
      this.readRepo.leavesInRange(vendorId, forecastDate, windowEnd),
    ]);

    // Single-date (forecastDate) for byList and aggregatedByType
    const dateListMap = computeForDate(subscriptions, leaves, forecastDate);

    const byList: ByListForecastItem[] = [];
    for (const [listId, acc] of dateListMap) {
      byList.push({
        listId: listId.toString(),
        listName: acc.listName,
        supplyType: acc.supplyType,
        quantity: Math.round(acc.quantity),
        unit: acc.unit,
        customerCount: acc.customerCount,
        plannedLeaves: acc.plannedLeaves,
      });
    }

    // aggregatedByType for the single date
    const aggregatedByType: Record<
      string,
      { totalQuantity: number; unit: string; lists: string[] }
    > = {};
    for (const item of byList) {
      const key = item.supplyType ?? item.listName;
      if (!aggregatedByType[key]) {
        aggregatedByType[key] = { totalQuantity: 0, unit: item.unit, lists: [] };
      }
      const entry = aggregatedByType[key];
      if (entry) {
        entry.totalQuantity += item.quantity;
        if (!entry.lists.includes(item.listName)) {
          entry.lists.push(item.listName);
        }
      }
    }

    // N-day window totals
    const windowTotals = new Map<string, { totalQuantity: number; unit: string }>();

    for (let i = 0; i < days; i++) {
      const d = addDays(forecastDate, i);
      const dayMap = computeForDate(subscriptions, leaves, d);
      for (const acc of dayMap.values()) {
        const key = acc.supplyType ?? acc.listName;
        const existing = windowTotals.get(key) ?? { totalQuantity: 0, unit: acc.unit };
        existing.totalQuantity += acc.quantity;
        windowTotals.set(key, existing);
      }
    }

    const nextNDays: Record<string, { totalQuantity: number; unit: string; dailyAverage: number }> =
      {};
    for (const [key, totals] of windowTotals) {
      nextNDays[key] = {
        totalQuantity: Math.round(totals.totalQuantity),
        unit: totals.unit,
        dailyAverage: Math.round(totals.totalQuantity / days),
      };
    }

    return {
      date: forecastDate,
      byList,
      aggregatedByType,
      nextNDays: { days, byType: nextNDays },
    };
  }
}
