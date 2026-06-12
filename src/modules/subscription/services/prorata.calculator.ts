/**
 * ProrataCalculator — pure money math, no side effects.
 * Formula (FEATURE_PLAN OQ-3):
 *   daysRemaining = max(0, nextBillingDate - today)  (inclusive of today)
 *   prorataAmount = round2( max(0, (dailyRateNew - dailyRateCurrent) * daysRemaining) )
 */
import { SubscriptionPlanEntity } from '../domain/plan.entity';
import { BillingCycleVO } from '../domain/value-objects/billing-cycle.vo';
import { BillingCycleEnum } from '../domain/subscription.types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysRemainingFrom(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.floor((to.getTime() - from.getTime()) / msPerDay);
  return Math.max(0, diff);
}

export class ProrataCalculator {
  /**
   * Compute pro-rata upgrade cost.
   *
   * @param currentPlan  The current active plan entity.
   * @param newPlan      The target plan entity.
   * @param billingCycle The billing cycle for the NEW plan.
   * @param today        Reference date (wall-clock "today").
   * @param nextBillingDate The nextBillingDate from the current subscription (may be null).
   * @returns INR amount (>= 0, 2dp) to be charged for the remaining days.
   */
  static compute(
    currentPlan: SubscriptionPlanEntity,
    newPlan: SubscriptionPlanEntity,
    billingCycle: BillingCycleEnum,
    today: Date,
    nextBillingDate: Date | null
  ): number {
    const cycle = BillingCycleVO.of(billingCycle);
    const cycleDays = cycle.days();

    const dailyRateNew = newPlan.priceForCycle(cycleDays) / cycleDays;
    const dailyRateCurrent = currentPlan.priceForCycle(cycleDays) / cycleDays;

    const daysLeft = nextBillingDate !== null ? daysRemainingFrom(today, nextBillingDate) : 0;

    const diff = dailyRateNew - dailyRateCurrent;
    const raw = diff * daysLeft;

    return round2(Math.max(0, raw));
  }
}
