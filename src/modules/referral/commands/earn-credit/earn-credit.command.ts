/**
 * EarnCreditCommand — atomic credit ledger entry (EARNED row).
 * Used by facade, milestone sweep, and revenue share cron.
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';
import { IDashboardCachePort } from '../../ports/dashboard-cache.port';
import { CreditSourceType, ReferralRewardKind } from '../../domain/vendor-referral.types';
import { CreditTransactionRow } from '../../database/referral.repository.port';

export interface EarnCreditInput {
  vendorId: bigint;
  amount: number;
  rewardKind?: ReferralRewardKind;
  sourceType?: CreditSourceType;
  sourceId?: bigint;
  description?: string;
}

export class EarnCreditCommand {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly dashboardCache: IDashboardCachePort<unknown>,
    private readonly logger: Logger
  ) {}

  async execute(input: EarnCreditInput): Promise<CreditTransactionRow> {
    this.logger.info(
      { vendorId: input.vendorId.toString(), amount: input.amount, rewardKind: input.rewardKind },
      'EarnCreditCommand: earning credit'
    );

    const txn = await this.repository.transaction(async (tx) => {
      return this.repository.earnCredit({
        vendorId: input.vendorId,
        amount: input.amount,
        ...(input.rewardKind !== undefined ? { rewardKind: input.rewardKind } : {}),
        ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
        ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        tx,
      });
    });

    // A reward was earned — dashboard earnings/balance changed for this vendor.
    await this.dashboardCache.invalidate(input.vendorId);

    return txn;
  }
}
