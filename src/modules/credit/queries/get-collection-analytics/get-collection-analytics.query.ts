import { prisma } from '@/infrastructure/database/prisma.client';
import { ICreditBalancePort } from '../../ports/credit-balance.port';
import { ICreditCustomerPort } from '../../ports/credit-customer.port';
import { AgingBucketVO } from '../../domain/value-objects/aging-bucket.vo';
import { CreditMapper } from '../../credit.mapper';

function prevMonths(count: number): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

export class GetCollectionAnalyticsQuery {
  constructor(
    private readonly balancePort: ICreditBalancePort,
    private readonly customerPort: ICreditCustomerPort
  ) {}

  async execute(vendorId: bigint, month?: string) {
    const targetMonth =
      month ??
      (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      })();

    const [totalBilled, collected, modeBreakdown] = await Promise.all([
      this.balancePort.getMonthlyBilled(vendorId, targetMonth),
      this.balancePort.getMonthlyCollected(vendorId, targetMonth),
      this.balancePort.getPaymentModeBreakdown(vendorId, targetMonth),
    ]);

    const outstanding = Math.max(0, totalBilled - collected);

    // Get collection trend (6 months)
    const trendMonths = prevMonths(6);
    const trend = await this.balancePort.getCollectionTrend(vendorId, trendMonths);

    // Top payers
    const topPayers = await this.balancePort.getTopPayers(vendorId, targetMonth, 5);

    // Defaulters: customers with balance > 0 ordered by days overdue
    const customers = await this.customerPort.listCustomersWithCredit(vendorId);
    const customerIds = customers.map((c) => c.id);
    const [balanceMap, oldestDateMap] =
      customerIds.length > 0
        ? await Promise.all([
            this.balancePort.getBulkBalances(customerIds, vendorId),
            this.balancePort.getOldestUnpaidServiceDate(customerIds, vendorId),
          ])
        : [new Map<string, number>(), new Map<string, Date | null>()];

    const today = new Date();
    const defaulters: Array<{
      customerId: bigint;
      customerName: string;
      amount: number;
      daysOverdue: number;
    }> = [];

    for (const c of customers) {
      const balance = balanceMap.get(c.id.toString()) ?? 0;
      if (balance <= 0) continue;
      const oldestDate = oldestDateMap.get(c.id.toString()) ?? null;
      const daysOverdue = oldestDate
        ? Math.max(0, Math.floor((today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;
      const aging = AgingBucketVO.fromDaysOverdue(daysOverdue);
      if (aging.daysOverdue > 30) {
        defaulters.push({ customerId: c.id, customerName: c.name, amount: balance, daysOverdue });
      }
    }
    defaulters.sort((a, b) => b.daysOverdue - a.daysOverdue);

    // Collection target
    const settings = await prisma.vendorSettings.findUnique({ where: { vendorId } });
    const target = settings?.defaultCreditLimit
      ? Number(settings.defaultCreditLimit.toString())
      : totalBilled;

    return CreditMapper.toAnalyticsResponse({
      month: targetMonth,
      totalBilled,
      collected,
      outstanding,
      target,
      modeBreakdown,
      trend,
      topPayers,
      defaulters: defaulters.slice(0, 10),
    });
  }
}
