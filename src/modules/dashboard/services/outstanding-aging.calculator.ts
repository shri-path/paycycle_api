/**
 * OutstandingAgingCalculator — standalone pure computation service.
 * Computes per-customer aging buckets, priorities, and advance credit.
 */
import { IDashboardReadRepository } from '../database/dashboard-read.repository.port';
import { PriorityCustomerItem, AdvanceCreditItem } from '../dashboard.types';

export interface AgingSummaryResult {
  fresh_0_30: { amount: number; customerCount: number };
  overdue_30_60: { amount: number; customerCount: number };
  critical_60_plus: { amount: number; customerCount: number };
  advanceCredit: number;
}

export interface AgingFullResult {
  summary: {
    totalOutstanding: number;
    fresh_0_30: { amount: number; customerCount: number };
    overdue_30_60: { amount: number; customerCount: number };
    critical_60_plus: { amount: number; customerCount: number };
  };
  priorityCustomers: {
    high: PriorityCustomerItem[];
    medium: PriorityCustomerItem[];
    low: PriorityCustomerItem[];
  };
  advanceCredit: {
    totalAmount: number;
    customerCount: number;
    customers: AdvanceCreditItem[];
  };
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}

function computePriority(
  utilizationPercentage: number,
  daysOverdue: number
): 'high' | 'medium' | 'low' {
  if (utilizationPercentage >= 90 || daysOverdue > 60) return 'high';
  if (utilizationPercentage >= 60 || daysOverdue > 30) return 'medium';
  return 'low';
}

export class OutstandingAgingCalculator {
  constructor(private readonly readRepo: IDashboardReadRepository) {}

  /** Lightweight summary used by FinancialSummaryCalculator. */
  async computeSummary(vendorId: bigint): Promise<AgingSummaryResult> {
    const full = await this.computeFull(vendorId);
    return {
      fresh_0_30: full.summary.fresh_0_30,
      overdue_30_60: full.summary.overdue_30_60,
      critical_60_plus: full.summary.critical_60_plus,
      advanceCredit: full.advanceCredit.totalAmount,
    };
  }

  async computeFull(
    vendorId: bigint,
    priority?: 'high' | 'medium' | 'low' | 'all',
    page = 1,
    limit = 20
  ): Promise<AgingFullResult & { totalPriorityCount: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const balances = await this.readRepo.customerBalances(vendorId);

    const fresh_0_30 = { amount: 0, customerCount: 0 };
    const overdue_30_60 = { amount: 0, customerCount: 0 };
    const critical_60_plus = { amount: 0, customerCount: 0 };

    const highPriority: PriorityCustomerItem[] = [];
    const mediumPriority: PriorityCustomerItem[] = [];
    const lowPriority: PriorityCustomerItem[] = [];

    const advanceCreditCustomers: AdvanceCreditItem[] = [];
    let advanceCreditTotal = 0;

    for (const row of balances) {
      if (row.balance < 0) {
        // Advance credit — show as negative credit balance
        advanceCreditTotal += Math.abs(row.balance);
        // Rough estimate: months covered = |balance| / typical monthly spend
        // Simple approximation: show absolute value
        advanceCreditCustomers.push({
          customerId: row.customerId.toString(),
          customerName: row.customerName,
          creditBalance: Math.round(row.balance), // negative value
          monthsCovered: 0, // simplified per spec
        });
        continue;
      }
      if (row.balance === 0) continue;

      const daysOverdue = row.oldestUnpaidDate ? daysBetween(row.oldestUnpaidDate, today) : 0;

      const utilizationPercentage =
        row.creditLimit > 0 ? Math.round((row.balance / row.creditLimit) * 100) : 0;

      const bucket =
        daysOverdue <= 30 ? 'fresh_0_30' : daysOverdue <= 60 ? 'overdue_30_60' : 'critical_60_plus';

      if (bucket === 'fresh_0_30') {
        fresh_0_30.amount += Math.round(row.balance);
        fresh_0_30.customerCount += 1;
      } else if (bucket === 'overdue_30_60') {
        overdue_30_60.amount += Math.round(row.balance);
        overdue_30_60.customerCount += 1;
      } else {
        critical_60_plus.amount += Math.round(row.balance);
        critical_60_plus.customerCount += 1;
      }

      const pri = computePriority(utilizationPercentage, daysOverdue);
      const item: PriorityCustomerItem = {
        customerId: row.customerId.toString(),
        customerName: row.customerName,
        outstanding: Math.round(row.balance),
        daysOverdue,
        creditLimit: Math.round(row.creditLimit),
        utilizationPercentage,
        lastPaymentDate: row.lastPaymentDate
          ? row.lastPaymentDate.toISOString().slice(0, 10)
          : null,
        paymentScore: Math.round(row.paymentScore),
      };

      if (pri === 'high') highPriority.push(item);
      else if (pri === 'medium') mediumPriority.push(item);
      else lowPriority.push(item);
    }

    // Sort: daysOverdue desc, outstanding desc within each group
    const sortFn = (a: PriorityCustomerItem, b: PriorityCustomerItem) =>
      b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding;

    highPriority.sort(sortFn);
    mediumPriority.sort(sortFn);
    lowPriority.sort(sortFn);

    // Paginate combined list by priority filter
    let allFiltered: PriorityCustomerItem[];
    if (!priority || priority === 'all') {
      allFiltered = [...highPriority, ...mediumPriority, ...lowPriority];
    } else if (priority === 'high') {
      allFiltered = highPriority;
    } else if (priority === 'medium') {
      allFiltered = mediumPriority;
    } else {
      allFiltered = lowPriority;
    }

    const totalPriorityCount = allFiltered.length;
    const offset = (page - 1) * limit;
    const paginated = allFiltered.slice(offset, offset + limit);

    // Re-group paginated into high/medium/low
    const paginatedHigh = paginated.filter((c) =>
      highPriority.some((h) => h.customerId === c.customerId)
    );
    const paginatedMedium = paginated.filter((c) =>
      mediumPriority.some((m) => m.customerId === c.customerId)
    );
    const paginatedLow = paginated.filter((c) =>
      lowPriority.some((l) => l.customerId === c.customerId)
    );

    const totalOutstanding = fresh_0_30.amount + overdue_30_60.amount + critical_60_plus.amount;

    return {
      summary: { totalOutstanding, fresh_0_30, overdue_30_60, critical_60_plus },
      priorityCustomers: {
        high: paginatedHigh,
        medium: paginatedMedium,
        low: paginatedLow,
      },
      advanceCredit: {
        totalAmount: Math.round(advanceCreditTotal),
        customerCount: advanceCreditCustomers.length,
        customers: advanceCreditCustomers,
      },
      totalPriorityCount,
    };
  }
}
