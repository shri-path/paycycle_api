/**
 * FinancialSummaryCalculator — pure computation service.
 * Computes monthly revenue, collected, pending, and related metrics.
 */
import { IDashboardReadRepository } from '../database/dashboard-read.repository.port';
import { OutstandingAgingCalculator } from './outstanding-aging.calculator';

export interface FinancialSummaryResult {
  totalRevenue: number;
  collected: number;
  pending: number;
  collectionPercentage: number;
  outstandingAging: {
    fresh_0_30: { amount: number; customerCount: number };
    overdue_30_60: { amount: number; customerCount: number };
    critical_60_plus: { amount: number; customerCount: number };
  };
  advanceCredit: number;
  netReceivable: number;
}

export class FinancialSummaryCalculator {
  constructor(
    private readonly readRepo: IDashboardReadRepository,
    private readonly agingCalculator: OutstandingAgingCalculator
  ) {}

  async compute(vendorId: bigint, month: string): Promise<FinancialSummaryResult> {
    const [year, mon] = month.split('-').map(Number);
    const monthStart = new Date(year!, mon! - 1, 1);
    const monthEnd = new Date(year!, mon!, 0); // last day of month

    const [totalRevenue, collected, agingResult] = await Promise.all([
      this.readRepo.monthlyRevenue(vendorId, monthStart, monthEnd),
      this.readRepo.monthlyCollected(vendorId, monthStart, monthEnd),
      this.agingCalculator.computeSummary(vendorId),
    ]);

    const pending = Math.max(totalRevenue - collected, 0);
    const collectionPercentage =
      totalRevenue === 0 ? 0 : Math.round((collected / totalRevenue) * 100);

    const totalOutstanding =
      agingResult.fresh_0_30.amount +
      agingResult.overdue_30_60.amount +
      agingResult.critical_60_plus.amount;

    const netReceivable = Math.max(totalOutstanding - agingResult.advanceCredit, 0);

    return {
      totalRevenue: Math.round(totalRevenue),
      collected: Math.round(collected),
      pending: Math.round(pending),
      collectionPercentage,
      outstandingAging: {
        fresh_0_30: agingResult.fresh_0_30,
        overdue_30_60: agingResult.overdue_30_60,
        critical_60_plus: agingResult.critical_60_plus,
      },
      advanceCredit: Math.round(agingResult.advanceCredit),
      netReceivable: Math.round(netReceivable),
    };
  }
}
