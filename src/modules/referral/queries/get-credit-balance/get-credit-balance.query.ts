/**
 * GetCreditBalanceQuery — credit balance summary.
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';
import { REWARD_AMOUNTS } from '../../domain/vendor-referral.types';

export interface CreditBalanceResult {
  availableCredits: number;
  lifetimeEarned: number;
  lifetimeUsed: number;
  withdrawalEligible: boolean;
  withdrawalMinimum: number;
}

export class GetCreditBalanceQuery {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly logger: Logger
  ) {}

  async execute(vendorId: bigint): Promise<CreditBalanceResult> {
    this.logger.info({ vendorId: vendorId.toString() }, 'GetCreditBalanceQuery');

    const creditRow = await this.repository.getVendorCreditBalance(vendorId);

    const available = creditRow?.availableCredits ?? 0;
    const lifetimeEarned = creditRow?.lifetimeCreditsEarned ?? 0;
    const lifetimeUsed = creditRow?.lifetimeCreditsUsed ?? 0;

    return {
      availableCredits: available,
      lifetimeEarned,
      lifetimeUsed,
      withdrawalEligible: available >= REWARD_AMOUNTS.WITHDRAWAL_MINIMUM,
      withdrawalMinimum: REWARD_AMOUNTS.WITHDRAWAL_MINIMUM,
    };
  }
}
