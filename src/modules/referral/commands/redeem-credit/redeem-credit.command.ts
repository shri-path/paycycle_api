/**
 * RedeemCreditCommand — redeem vendor credits for subscription, upgrade.
 * USER DECISION: 'withdraw' is DISABLED in v1 — returns 400 WITHDRAWAL_NOT_AVAILABLE.
 */
import { Logger } from 'pino';
import { BadRequestError, ConflictError } from '@/common/errors/app-error';
import { IReferralRepository } from '../../database/referral.repository.port';
import { ISubscriptionCreditPort } from '../../ports/subscription-credit.port';
import { IDashboardCachePort } from '../../ports/dashboard-cache.port';
import { CreditSourceType } from '../../domain/vendor-referral.types';

export type RedemptionType = 'subscription' | 'upgrade' | 'withdraw';

export interface RedeemCreditInput {
  vendorId: bigint;
  redemptionType: RedemptionType;
  amount: number;
}

export interface RedeemCreditResult {
  redemptionType: RedemptionType;
  amountApplied: number;
  feeCharged: number;
  newBalance: number;
  status: 'APPLIED' | 'PENDING_PAYOUT';
}

export class RedeemCreditCommand {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly subscriptionCreditPort: ISubscriptionCreditPort,
    private readonly dashboardCache: IDashboardCachePort<unknown>,
    private readonly logger: Logger
  ) {}

  async execute(input: RedeemCreditInput): Promise<RedeemCreditResult> {
    this.logger.info(
      {
        vendorId: input.vendorId.toString(),
        redemptionType: input.redemptionType,
        amount: input.amount,
      },
      'RedeemCreditCommand: redeeming credit'
    );

    // USER DECISION: withdrawal disabled in v1
    if (input.redemptionType === 'withdraw') {
      this.logger.warn(
        { vendorId: input.vendorId.toString() },
        'Withdrawal attempt blocked — not available in v1'
      );
      throw new BadRequestError(
        'Cash withdrawal is not available in this version. Please use credits for subscription or upgrade discounts.'
      );
    }

    // Validate amount
    if (input.amount <= 0) {
      throw new BadRequestError('Redemption amount must be greater than 0');
    }

    // Atomic balance-check + deduction in a single transaction to prevent TOCTOU race.
    // The balance is re-read inside the transaction before decrementing.
    let newBalance = 0;
    await this.repository.transaction(async (tx) => {
      const creditRow = await this.repository.getVendorCreditBalance(input.vendorId, tx);
      const available = creditRow?.availableCredits ?? 0;

      if (input.amount > available) {
        this.logger.warn(
          { vendorId: input.vendorId.toString(), available, requested: input.amount },
          'Insufficient credits for redemption'
        );
        throw new ConflictError(
          `Insufficient credits. Available: ₹${available}, Requested: ₹${input.amount}`
        );
      }

      const txnRow = await this.repository.useCredit({
        vendorId: input.vendorId,
        amount: input.amount,
        sourceType: CreditSourceType.SUBSCRIPTION_PAYMENT,
        description:
          input.redemptionType === 'subscription'
            ? `Credit redeemed for subscription payment`
            : `Credit redeemed for plan upgrade`,
        tx,
      });
      newBalance = txnRow.balanceAfter;
    });

    // Redemption changed the available balance — drop the cached dashboard so the
    // next read reflects the new balance immediately (invalidation after commit).
    await this.dashboardCache.invalidate(input.vendorId);

    // Apply to subscription (stub in v1)
    if (input.redemptionType === 'subscription') {
      await this.subscriptionCreditPort.applyCreditToNextInvoice(input.vendorId, input.amount);
    } else {
      await this.subscriptionCreditPort.applyCreditToUpgrade(input.vendorId, input.amount);
    }

    return {
      redemptionType: input.redemptionType,
      amountApplied: input.amount,
      feeCharged: 0,
      newBalance,
      status: 'APPLIED',
    };
  }
}
