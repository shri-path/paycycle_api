/**
 * ListPlansQuery — returns all active subscription plans ordered by tier.
 */
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import { ListPlansResult } from '../../subscription.types';

export class ListPlansQuery {
  constructor(private readonly planRepo: ISubscriptionPlanRepository) {}

  async execute(): Promise<ListPlansResult> {
    const plans = await this.planRepo.findAllActive();
    // Plans are returned ordered by id asc (STARTER=1, GROWTH=2, PRO=3 by seed)
    return { plans: plans.map((p) => SubscriptionMapper.toPlanDto(p)) };
  }
}
