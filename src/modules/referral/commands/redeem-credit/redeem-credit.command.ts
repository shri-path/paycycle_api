/**
 * RedeemCreditCommand — redeem vendor credits for subscription, upgrade.
 * USER DECISION: 'withdraw' is DISABLED in v1 — returns 400 WITHDRAWAL_NOT_AVAILABLE.
 */
import crypto from 'crypto';
import { Logger } from 'pino';
import { BadRequestError, ConflictError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { IReferralRepository } from '../../database/referral.repository.port';
import { ISubscriptionCreditPort } from '../../ports/subscription-credit.port';
import { IDashboardCachePort } from '../../ports/dashboard-cache.port';
import { ReferralEventDispatcher } from '../../domain/events/referral-event-dispatcher';
import { CreditRedeemedEvent } from '../../domain/events/vendor-referral.domain-events';
import { CreditSourceType } from '../../domain/vendor-referral.types';

export type RedemptionType = 'subscription' | 'upgrade' | 'withdraw';

export interface RedeemCreditInput {
  vendorId: bigint;
  redemptionType: RedemptionType;
  amount: number;
  /** Acting owner's user id (for the audit actor). Null falls back to system. */
  actorUserId?: bigint | null;
  /** Acting owner's role slug (for the audit actor). */
  actorRole?: string;
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
    private readonly auditLogger: AuditPort,
    private readonly events: ReferralEventDispatcher,
    private readonly logger: Logger
  ) {}

  async execute(input: RedeemCreditInput): Promise<RedeemCreditResult> {
    const correlationId = crypto.randomUUID();
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
    let transactionId: bigint | null = null;
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
      transactionId = txnRow.id;
    });

    // Redemption changed the available balance — drop the cached dashboard so the
    // next read reflects the new balance immediately (invalidation after commit).
    await this.dashboardCache.invalidate(input.vendorId);

    // Audit the (now-committed) credit-decreasing operation. Best-effort: AuditLogger
    // swallows+logs its own failures, so a failed audit write never rolls back the
    // ledger transaction above nor fails the caller's redemption.
    const performedByRole = input.actorRole ?? (input.actorUserId ? null : 'system');
    await this.auditLogger.log({
      vendorId: input.vendorId,
      performedByUserId: input.actorUserId ?? null,
      ...(performedByRole !== null ? { performedByRole } : {}),
      action: AuditAction.REFERRAL_CREDIT_REDEEMED,
      entityType: 'vendor_credit',
      entityId: input.vendorId,
      metadata: {
        amount: input.amount,
        redemptionType: input.redemptionType,
        balanceAfter: newBalance,
        transactionId: transactionId != null ? (transactionId as bigint).toString() : null,
        correlationId,
      },
      correlationId,
    });

    // US-15.3: publish CreditRedeemed (post-commit, best-effort). The dispatcher
    // swallows handler errors so event delivery never fails the redemption.
    await this.events.publish(
      new CreditRedeemedEvent({
        aggregateId:
          transactionId != null ? (transactionId as bigint).toString() : input.vendorId.toString(),
        vendorId: input.vendorId.toString(),
        amount: input.amount,
        redemptionType: input.redemptionType,
        metadata: { correlationId },
      })
    );

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
