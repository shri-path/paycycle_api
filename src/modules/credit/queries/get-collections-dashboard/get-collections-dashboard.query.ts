import { prisma } from '@/infrastructure/database/prisma.client';
import { ICreditBalancePort } from '../../ports/credit-balance.port';
import { ICreditCustomerPort } from '../../ports/credit-customer.port';
import { AgingBucketVO, AgingBucketEnum } from '../../domain/value-objects/aging-bucket.vo';
import { CreditMapper } from '../../credit.mapper';

export class GetCollectionsDashboardQuery {
  constructor(
    private readonly balancePort: ICreditBalancePort,
    private readonly customerPort: ICreditCustomerPort
  ) {}

  async execute(vendorId: bigint) {
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
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    const [thisMonthBilled, thisMonthCollected] = await Promise.all([
      this.balancePort.getMonthlyBilled(vendorId, month),
      this.balancePort.getMonthlyCollected(vendorId, month),
    ]);

    // Load target from vendor settings
    const settings = await prisma.vendorSettings.findUnique({ where: { vendorId } });
    const collectionTarget = settings?.defaultCreditLimit
      ? Number(settings.defaultCreditLimit.toString())
      : thisMonthBilled;

    const agingBuckets = new Map<AgingBucketEnum, { amount: number; count: number }>();
    let totalOutstanding = 0;
    let totalAdvance = 0;
    let advanceCount = 0;
    const customersAtLimit: Array<{
      customerId: bigint;
      name: string;
      utilizationPercentage: number;
    }> = [];

    for (const customer of customers) {
      const key = customer.id.toString();
      const balance = balanceMap.get(key) ?? 0;

      if (balance < 0) {
        // Advance credit
        totalAdvance += Math.abs(balance);
        advanceCount++;
        continue;
      }

      if (balance <= 0) continue;

      totalOutstanding += balance;

      const oldestDate = oldestDateMap.get(key) ?? null;
      const daysOverdue = oldestDate
        ? Math.max(0, Math.floor((today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      const agingVO = AgingBucketVO.fromDaysOverdue(daysOverdue);
      const bucket = agingVO.unpack();
      const current = agingBuckets.get(bucket) ?? { amount: 0, count: 0 };
      agingBuckets.set(bucket, { amount: current.amount + balance, count: current.count + 1 });

      // Check near-limit
      if (customer.creditLimit > 0) {
        const utilization = Math.round((balance / customer.creditLimit) * 100);
        if (utilization >= 80) {
          customersAtLimit.push({
            customerId: customer.id,
            name: customer.name,
            utilizationPercentage: utilization,
          });
        }
      }
    }

    const netReceivable = totalOutstanding - totalAdvance;

    return CreditMapper.toDashboardResponse({
      agingBuckets,
      advanceCredit: { totalAmount: totalAdvance, customerCount: advanceCount },
      netReceivable,
      totalOutstanding,
      thisMonthBilled,
      thisMonthCollected,
      collectionTarget,
      customersAtLimit,
    });
  }
}
