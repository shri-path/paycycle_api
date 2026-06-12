/**
 * GetVendorSubscriptionQuery — current plan + live usage + utilization + canAddMore.
 */
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { IUsageCounter } from '../../ports/usage-counter.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import { SubscriptionNotFoundError, PlanNotFoundError } from '../../domain/subscription.errors';
import { SubscriptionViewDto, UsageDto } from '../../subscription.types';
function computeUtilization(usage: number, max: number): number {
  if (max === 0) return 0; // unlimited
  return Math.round((usage / max) * 100);
}

export class GetVendorSubscriptionQuery {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly planRepo: ISubscriptionPlanRepository,
    private readonly usageCounter: IUsageCounter
  ) {}

  async execute(vendorId: bigint): Promise<SubscriptionViewDto> {
    const subRow = await this.subscriptionRepo.findActiveByVendor(vendorId);
    if (!subRow) throw new SubscriptionNotFoundError();

    const plan = await this.planRepo.findActiveById(subRow.subscriptionPlanId);
    if (!plan) throw new PlanNotFoundError('Current plan not found');

    const usage = await this.usageCounter.countAll(vendorId);

    const util: UsageDto = {
      customers: computeUtilization(usage.customers, plan.limits.maxCustomers),
      staff: computeUtilization(usage.staff, plan.limits.maxStaff),
      supplyLists: computeUtilization(usage.supplyLists, plan.limits.maxSupplyLists),
    };

    const canAddMore = {
      customers: plan.limits.allows('customers', usage.customers),
      staff: plan.limits.allows('staff', usage.staff),
      supplyLists: plan.limits.allows('supplyLists', usage.supplyLists),
    };

    return SubscriptionMapper.toSubscriptionViewDto(subRow, plan, usage, util, canAddMore);
  }
}
