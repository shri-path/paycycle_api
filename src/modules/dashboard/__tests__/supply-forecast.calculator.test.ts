/**
 * Unit tests for SupplyForecastCalculator.
 */
import { SupplyForecastCalculator } from '../services/supply-forecast.calculator';
import { IDashboardReadRepository } from '../database/dashboard-read.repository.port';
import { ForecastSubscriptionRow, LeaveRow } from '../dashboard.types';

function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function makeRepo(
  subscriptions: ForecastSubscriptionRow[] = [],
  leaves: LeaveRow[] = []
): IDashboardReadRepository {
  return {
    monthlyRevenue: jest.fn().mockResolvedValue(0),
    monthlyCollected: jest.fn().mockResolvedValue(0),
    customerBalances: jest.fn().mockResolvedValue([]),
    quickStats: jest.fn().mockResolvedValue({
      supplyListsCount: 0,
      totalCustomers: 0,
      activeStaff: 0,
      conflictsToday: 0,
    }),
    todayListProgress: jest.fn().mockResolvedValue([]),
    activeSubscriptionsForForecast: jest.fn().mockResolvedValue(subscriptions),
    leavesInRange: jest.fn().mockResolvedValue(leaves),
    staffName: jest.fn().mockResolvedValue(null),
    staffExistsInVendor: jest.fn().mockResolvedValue(false),
  };
}

const BASE_SUB: ForecastSubscriptionRow = {
  subscriptionId: 1n,
  listId: 10n,
  listName: 'Morning Milk',
  supplyType: 'milk',
  unit: 'ltr',
  defaultQuantity: 2,
  customQuantity: null,
  customerId: 100n,
  startDate: null,
  endDate: null,
  frequency: 'DAILY',
};

describe('SupplyForecastCalculator', () => {
  it('should use customQuantity over defaultQuantity', async () => {
    const sub: ForecastSubscriptionRow = { ...BASE_SUB, customQuantity: 3, defaultQuantity: 2 };
    const repo = makeRepo([sub]);
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, tomorrow(), 1);
    expect(result.byList[0]?.quantity).toBe(3);
  });

  it('should use defaultQuantity when customQuantity is null', async () => {
    const repo = makeRepo([BASE_SUB]);
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, tomorrow(), 1);
    expect(result.byList[0]?.quantity).toBe(2);
  });

  it('should exclude a subscriber on leave and increment plannedLeaves', async () => {
    const date = tomorrow();
    const leave: LeaveRow = {
      supplyListCustomerId: 1n, // matches BASE_SUB.subscriptionId
      startDate: date,
      endDate: date,
    };
    const sub2: ForecastSubscriptionRow = {
      ...BASE_SUB,
      subscriptionId: 2n,
      customerId: 200n,
      defaultQuantity: 3,
    };
    const repo = makeRepo([BASE_SUB, sub2], [leave]);
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, date, 1);

    const item = result.byList[0]!;
    expect(item.customerCount).toBe(1); // sub2 still delivers
    expect(item.plannedLeaves).toBe(1); // BASE_SUB on leave
    expect(item.quantity).toBe(3); // only sub2's qty
  });

  it('should return quantity 0 and plannedLeaves = subscriber count when 100% on leave', async () => {
    const date = tomorrow();
    const leave: LeaveRow = {
      supplyListCustomerId: 1n,
      startDate: date,
      endDate: date,
    };
    const repo = makeRepo([BASE_SUB], [leave]);
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, date, 1);

    const item = result.byList[0]!;
    expect(item.quantity).toBe(0);
    expect(item.plannedLeaves).toBe(1);
    expect(item.customerCount).toBe(0);
  });

  it('should aggregate by supplyType', async () => {
    const eveningSub: ForecastSubscriptionRow = {
      ...BASE_SUB,
      subscriptionId: 3n,
      listId: 11n,
      listName: 'Evening Milk',
      supplyType: 'milk',
      defaultQuantity: 1.5,
      customerId: 300n,
    };
    const repo = makeRepo([BASE_SUB, eveningSub]);
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, tomorrow(), 1);

    expect(result.aggregatedByType['milk']?.totalQuantity).toBe(4); // 2 + 1.5 rounded? let's see
    expect(result.aggregatedByType['milk']?.lists).toContain('Morning Milk');
    expect(result.aggregatedByType['milk']?.lists).toContain('Evening Milk');
  });

  it('should calculate dailyAverage over N-day window', async () => {
    const repo = makeRepo([BASE_SUB]); // 2 ltr every day
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, tomorrow(), 7);

    expect(result.nextNDays.byType['milk']?.totalQuantity).toBe(14); // 2*7
    expect(result.nextNDays.byType['milk']?.dailyAverage).toBe(2);
  });

  it('should include open-ended subscription (null endDate)', async () => {
    const sub: ForecastSubscriptionRow = {
      ...BASE_SUB,
      startDate: new Date('2020-01-01'),
      endDate: null,
    };
    const repo = makeRepo([sub]);
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, tomorrow(), 1);
    expect(result.byList).toHaveLength(1);
    expect(result.byList[0]?.customerCount).toBe(1);
  });

  it('should exclude subscription that starts after forecast date', async () => {
    const futureStart = new Date();
    futureStart.setDate(futureStart.getDate() + 10);
    const sub: ForecastSubscriptionRow = {
      ...BASE_SUB,
      startDate: futureStart,
      endDate: null,
    };
    const repo = makeRepo([sub]);
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, tomorrow(), 1);
    expect(result.byList).toHaveLength(0);
  });

  it('should return empty byList when no active subscriptions', async () => {
    const repo = makeRepo([]);
    const calc = new SupplyForecastCalculator(repo);
    const result = await calc.compute(1n, tomorrow(), 7);
    expect(result.byList).toHaveLength(0);
    expect(Object.keys(result.aggregatedByType)).toHaveLength(0);
  });
});
