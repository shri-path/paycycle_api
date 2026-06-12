/**
 * Unit tests for FinancialSummaryCalculator.
 */
import { FinancialSummaryCalculator } from '../services/financial-summary.calculator';
import { OutstandingAgingCalculator } from '../services/outstanding-aging.calculator';
import { IDashboardReadRepository } from '../database/dashboard-read.repository.port';

function makeReadRepo(overrides: Partial<IDashboardReadRepository> = {}): IDashboardReadRepository {
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
    activeSubscriptionsForForecast: jest.fn().mockResolvedValue([]),
    leavesInRange: jest.fn().mockResolvedValue([]),
    staffName: jest.fn().mockResolvedValue(null),
    staffExistsInVendor: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

const VENDOR_ID = 1n;
const MONTH = '2026-04';

describe('FinancialSummaryCalculator', () => {
  it('should return zero collectionPercentage when totalRevenue is 0', async () => {
    const repo = makeReadRepo({
      monthlyRevenue: jest.fn().mockResolvedValue(0),
      monthlyCollected: jest.fn().mockResolvedValue(0),
    });
    const agingCalc = new OutstandingAgingCalculator(repo);
    const calc = new FinancialSummaryCalculator(repo, agingCalc);

    const result = await calc.compute(VENDOR_ID, MONTH);
    expect(result.collectionPercentage).toBe(0);
    expect(result.pending).toBe(0);
  });

  it('should calculate collectionPercentage correctly', async () => {
    const repo = makeReadRepo({
      monthlyRevenue: jest.fn().mockResolvedValue(78600),
      monthlyCollected: jest.fn().mockResolvedValue(65208),
    });
    const agingCalc = new OutstandingAgingCalculator(repo);
    const calc = new FinancialSummaryCalculator(repo, agingCalc);

    const result = await calc.compute(VENDOR_ID, MONTH);
    expect(result.totalRevenue).toBe(78600);
    expect(result.collected).toBe(65208);
    expect(result.collectionPercentage).toBe(83); // round(65208/78600*100)
  });

  it('should clamp pending to 0 when collected > revenue', async () => {
    const repo = makeReadRepo({
      monthlyRevenue: jest.fn().mockResolvedValue(1000),
      monthlyCollected: jest.fn().mockResolvedValue(1500), // advance
    });
    const agingCalc = new OutstandingAgingCalculator(repo);
    const calc = new FinancialSummaryCalculator(repo, agingCalc);

    const result = await calc.compute(VENDOR_ID, MONTH);
    expect(result.pending).toBe(0);
  });

  it('should exclude LEAVE/CANCELLED/PENDING from revenue (handled at repo level)', async () => {
    // The repo is responsible for filtering; calculator just adds up what the repo returns.
    // We verify the calculator correctly uses the repo value.
    const repo = makeReadRepo({
      monthlyRevenue: jest.fn().mockResolvedValue(5000),
      monthlyCollected: jest.fn().mockResolvedValue(3000),
    });
    const agingCalc = new OutstandingAgingCalculator(repo);
    const calc = new FinancialSummaryCalculator(repo, agingCalc);

    const result = await calc.compute(VENDOR_ID, MONTH);
    expect(result.totalRevenue).toBe(5000);
  });
});
