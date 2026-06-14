import { ICreditBalancePort } from '../../ports/credit-balance.port';
import { ICreditCustomerPort } from '../../ports/credit-customer.port';
import { AgingBucketVO, AgingBucketEnum } from '../../domain/value-objects/aging-bucket.vo';
import { CreditMapper } from '../../credit.mapper';

export class GetOutstandingAgingQuery {
  constructor(
    private readonly balancePort: ICreditBalancePort,
    private readonly customerPort: ICreditCustomerPort
  ) {}

  async execute(vendorId: bigint) {
    const customers = await this.customerPort.listCustomersWithCredit(vendorId);
    if (customers.length === 0) {
      return CreditMapper.toAgingResponse({
        totalOutstanding: 0,
        agingBuckets: new Map(),
      });
    }

    const customerIds = customers.map((c) => c.id);
    const [balanceMap, oldestDateMap] = await Promise.all([
      this.balancePort.getBulkBalances(customerIds, vendorId),
      this.balancePort.getOldestUnpaidServiceDate(customerIds, vendorId),
    ]);

    const today = new Date();
    const agingBuckets = new Map<AgingBucketEnum, { amount: number; count: number }>();

    let totalOutstanding = 0;

    for (const customer of customers) {
      const key = customer.id.toString();
      const balance = balanceMap.get(key) ?? 0;
      if (balance <= 0) continue; // Only customers with outstanding

      totalOutstanding += balance;

      const oldestDate = oldestDateMap.get(key) ?? null;
      const daysOverdue = oldestDate
        ? Math.max(0, Math.floor((today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      const agingVO = AgingBucketVO.fromDaysOverdue(daysOverdue);
      const bucket = agingVO.unpack();

      const current = agingBuckets.get(bucket) ?? { amount: 0, count: 0 };
      agingBuckets.set(bucket, { amount: current.amount + balance, count: current.count + 1 });
    }

    return CreditMapper.toAgingResponse({ totalOutstanding, agingBuckets });
  }
}
