/**
 * Unit tests for OutstandingAgingCalculator.
 */
import { OutstandingAgingCalculator } from '../services/outstanding-aging.calculator';
import { IDashboardReadRepository } from '../database/dashboard-read.repository.port';

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function makeRepo(
  balances: Awaited<ReturnType<IDashboardReadRepository['customerBalances']>>
): IDashboardReadRepository {
  return {
    monthlyRevenue: jest.fn().mockResolvedValue(0),
    monthlyCollected: jest.fn().mockResolvedValue(0),
    customerBalances: jest.fn().mockResolvedValue(balances),
    quickStats: jest.fn().mockResolvedValue({
      supplyListsCount: 0,
      totalCustomers: 0,
      activeStaff: 0,
      conflictsToday: 0,
    }),
    todayListProgress: jest.fn().mockResolvedValue([]),
    activeSubscriptionsForForecast: jest.fn().mockResolvedValue([]),
    leavesInRange: jest.fn().mockResolvedValue([]),
    staffName: jest.fn().mockResolvedValue(null),
    staffExistsInVendor: jest.fn().mockResolvedValue(false),
  };
}

describe('OutstandingAgingCalculator', () => {
  it('should put customer with 25 days overdue in fresh_0_30 bucket', async () => {
    const repo = makeRepo([
      {
        customerId: 1n,
        customerName: 'Customer A',
        balance: 1000,
        creditLimit: 5000,
        paymentScore: 80,
        lastPaymentDate: null,
        oldestUnpaidDate: daysAgo(25),
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n, 'all', 1, 100);
    expect(result.summary.fresh_0_30.amount).toBe(1000);
    expect(result.summary.fresh_0_30.customerCount).toBe(1);
    expect(result.summary.overdue_30_60.customerCount).toBe(0);
    expect(result.summary.critical_60_plus.customerCount).toBe(0);
  });

  it('should put customer with 45 days overdue in overdue_30_60 bucket', async () => {
    const repo = makeRepo([
      {
        customerId: 2n,
        customerName: 'Customer B',
        balance: 2000,
        creditLimit: 0,
        paymentScore: 60,
        lastPaymentDate: null,
        oldestUnpaidDate: daysAgo(45),
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n);
    expect(result.summary.overdue_30_60.amount).toBe(2000);
    expect(result.summary.overdue_30_60.customerCount).toBe(1);
  });

  it('should put customer with 70 days overdue in critical_60_plus bucket', async () => {
    const repo = makeRepo([
      {
        customerId: 3n,
        customerName: 'Customer C',
        balance: 3000,
        creditLimit: 3000,
        paymentScore: 40,
        lastPaymentDate: null,
        oldestUnpaidDate: daysAgo(70),
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n);
    expect(result.summary.critical_60_plus.amount).toBe(3000);
  });

  it('should skip customers with balance <= 0', async () => {
    const repo = makeRepo([
      {
        customerId: 4n,
        customerName: 'Paid Customer',
        balance: 0,
        creditLimit: 1000,
        paymentScore: 100,
        lastPaymentDate: new Date(),
        oldestUnpaidDate: null,
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n);
    expect(result.summary.totalOutstanding).toBe(0);
    expect(result.advanceCredit.customerCount).toBe(0);
  });

  it('should move negative balance customers to advanceCredit section', async () => {
    const repo = makeRepo([
      {
        customerId: 5n,
        customerName: 'Advance Customer',
        balance: -2500,
        creditLimit: 1000,
        paymentScore: 95,
        lastPaymentDate: new Date(),
        oldestUnpaidDate: null,
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n);
    expect(result.advanceCredit.totalAmount).toBe(2500);
    expect(result.advanceCredit.customerCount).toBe(1);
    expect(result.advanceCredit.customers[0]?.creditBalance).toBe(-2500);
  });

  it('should return utilizationPercentage 0 when creditLimit is 0', async () => {
    const repo = makeRepo([
      {
        customerId: 6n,
        customerName: 'No Limit',
        balance: 500,
        creditLimit: 0,
        paymentScore: 70,
        lastPaymentDate: null,
        oldestUnpaidDate: daysAgo(10),
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n);
    const customerEntry = [
      ...result.priorityCustomers.high,
      ...result.priorityCustomers.medium,
      ...result.priorityCustomers.low,
    ].find((c) => c.customerId === '6');
    expect(customerEntry?.utilizationPercentage).toBe(0);
  });

  it('should classify high priority when utilization >= 90', async () => {
    const repo = makeRepo([
      {
        customerId: 7n,
        customerName: 'High Priority Customer',
        balance: 4500,
        creditLimit: 5000, // 90% utilization
        paymentScore: 30,
        lastPaymentDate: null,
        oldestUnpaidDate: daysAgo(10),
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n);
    expect(result.priorityCustomers.high).toHaveLength(1);
  });

  it('should classify medium priority when daysOverdue > 30 but <= 60', async () => {
    const repo = makeRepo([
      {
        customerId: 8n,
        customerName: 'Medium Priority',
        balance: 800,
        creditLimit: 5000, // low utilization
        paymentScore: 65,
        lastPaymentDate: null,
        oldestUnpaidDate: daysAgo(35),
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n);
    expect(result.priorityCustomers.medium).toHaveLength(1);
  });

  it('should sort within priority group by daysOverdue desc', async () => {
    const repo = makeRepo([
      {
        customerId: 9n,
        customerName: 'C1',
        balance: 100,
        creditLimit: 0,
        paymentScore: 80,
        lastPaymentDate: null,
        oldestUnpaidDate: daysAgo(10),
      },
      {
        customerId: 10n,
        customerName: 'C2',
        balance: 200,
        creditLimit: 0,
        paymentScore: 80,
        lastPaymentDate: null,
        oldestUnpaidDate: daysAgo(20),
      },
    ]);
    const calc = new OutstandingAgingCalculator(repo);
    const result = await calc.computeFull(1n);
    const low = result.priorityCustomers.low;
    // C2 has 20 days overdue, C1 has 10 — C2 should come first
    expect(low[0]?.customerId).toBe('10');
    expect(low[1]?.customerId).toBe('9');
  });
});
