/**
 * ListSubscriptionHistoryQuery — paginated subscription event history.
 * Looks up plan names for oldPlanId/newPlanId to produce readable history rows.
 */
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import { HistoryEventDto } from '../../subscription.types';

export interface ListHistoryResult {
  rows: HistoryEventDto[];
  total: number;
}

export class ListSubscriptionHistoryQuery {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly planRepo: ISubscriptionPlanRepository
  ) {}

  async execute(vendorId: bigint, page: number, limit: number): Promise<ListHistoryResult> {
    const { rows, total } = await this.subscriptionRepo.listHistory(vendorId, page, limit);

    // Collect unique plan IDs for name lookup
    const planIds = new Set<bigint>();
    for (const row of rows) {
      if (row.oldPlanId) planIds.add(row.oldPlanId);
      if (row.newPlanId) planIds.add(row.newPlanId);
    }

    // Build plan name map
    const planNameMap = new Map<string, string>();
    await Promise.all(
      Array.from(planIds).map(async (planId) => {
        const plan = await this.planRepo.findActiveById(planId);
        if (plan) planNameMap.set(planId.toString(), plan.planName);
      })
    );

    const dtos = rows.map((row) =>
      SubscriptionMapper.toHistoryDto(
        row,
        row.oldPlanId ? (planNameMap.get(row.oldPlanId.toString()) ?? null) : null,
        row.newPlanId ? (planNameMap.get(row.newPlanId.toString()) ?? null) : null
      )
    );

    return { rows: dtos, total };
  }
}
