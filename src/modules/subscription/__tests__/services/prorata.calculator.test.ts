/**
 * ProrataCalculator unit tests.
 * Formula: round2(max(0, (dailyRateNew - dailyRateCurrent) * daysRemaining))
 */
import { ProrataCalculator } from '../../services/prorata.calculator';
import { SubscriptionPlanEntity } from '../../domain/plan.entity';
import { BillingCycleEnum } from '../../domain/subscription.types';

function makePlan(
  id: bigint,
  planCode: string,
  priceMonthly: number,
  priceYearly: number
): SubscriptionPlanEntity {
  return SubscriptionPlanEntity.fromPersistence({
    id,
    planCode,
    planName: planCode,
    priceMonthly,
    priceYearly,
    maxCustomers: 0,
    maxStaff: 0,
    maxSupplyLists: 0,
    features: null,
    isActive: true,
  });
}

const starter = makePlan(1n, 'STARTER', 0, 0);
const growth = makePlan(2n, 'GROWTH', 300, 3000);
const pro = makePlan(3n, 'PRO', 600, 6000);

const TODAY = new Date('2026-01-01');
const NEXT_BILLING_30 = new Date('2026-01-31'); // 30 days away (monthly)

describe('ProrataCalculator', () => {
  it('full month remaining: STARTER→GROWTH monthly = 30 * (300/30 - 0/30)', () => {
    // dailyNew = 300/30 = 10, dailyCurrent = 0, daysLeft = 30
    // result = 30 * 10 = 300
    const result = ProrataCalculator.compute(
      starter,
      growth,
      BillingCycleEnum.MONTHLY,
      TODAY,
      NEXT_BILLING_30
    );
    expect(result).toBe(300);
  });

  it('half month remaining: STARTER→GROWTH monthly = 15 * 10 = 150', () => {
    const nextBilling15 = new Date('2026-01-16'); // 15 days away
    const result = ProrataCalculator.compute(
      starter,
      growth,
      BillingCycleEnum.MONTHLY,
      TODAY,
      nextBilling15
    );
    expect(result).toBe(150);
  });

  it('GROWTH→PRO monthly with 15 days remaining = 15 * 10 = 150', () => {
    // dailyNew = 600/30 = 20, dailyCurrent = 300/30 = 10, diff = 10, days = 15
    const nextBilling15 = new Date('2026-01-16');
    const result = ProrataCalculator.compute(
      growth,
      pro,
      BillingCycleEnum.MONTHLY,
      TODAY,
      nextBilling15
    );
    expect(result).toBe(150);
  });

  it('returns 0 when nextBillingDate is null (no remaining time)', () => {
    const result = ProrataCalculator.compute(
      starter,
      growth,
      BillingCycleEnum.MONTHLY,
      TODAY,
      null
    );
    expect(result).toBe(0);
  });

  it('returns 0 when nextBillingDate is in the past', () => {
    const pastDate = new Date('2025-12-01'); // before TODAY
    const result = ProrataCalculator.compute(
      starter,
      growth,
      BillingCycleEnum.MONTHLY,
      TODAY,
      pastDate
    );
    expect(result).toBe(0);
  });

  it('yearly billing: STARTER→GROWTH = 365 * (3000/365 - 0/365) ≈ 3000', () => {
    const nextBillingYearly = new Date('2027-01-01'); // 365 days away
    const result = ProrataCalculator.compute(
      starter,
      growth,
      BillingCycleEnum.YEARLY,
      TODAY,
      nextBillingYearly
    );
    expect(result).toBe(3000);
  });

  it('result is rounded to 2 decimal places', () => {
    // Use prices that produce fractional daily rates
    const planA = makePlan(4n, 'STARTER', 0, 0);
    const planB = makePlan(5n, 'GROWTH', 100, 1000);
    // daily rate = 100/30 ≈ 3.333, with 1 day left = 3.33
    const oneDayLeft = new Date('2026-01-02');
    const result = ProrataCalculator.compute(
      planA,
      planB,
      BillingCycleEnum.MONTHLY,
      TODAY,
      oneDayLeft
    );
    // 3.3333... * 1 = 3.33 after round2
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(Math.round(result * 100) / 100);
  });
});
