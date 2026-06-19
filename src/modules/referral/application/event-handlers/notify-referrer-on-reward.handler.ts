/**
 * NotifyReferrerOnRewardHandler (US-15.3) — subscribes to ReferralRewardEarnedEvent
 * and notifies the REFERRER (the vendor whose balance was credited) of the reward
 * type and amount, satisfying US-014 AC "Send notification to referrer".
 *
 * Per-tenant: the referrer's vendorId is both recipient and tenant key.
 * Idempotent by construction: the event is only published *after* a reward row is
 * written inside the existing reward-write guards (signup first-wins,
 * milestone10At/50At stamps, hasRevenueShareForMonth), so a cron re-run never
 * re-publishes and therefore never re-notifies.
 * Best-effort: a notification-port failure is logged and swallowed so it can never
 * break the already-committed reward transaction.
 */
import { Logger } from 'pino';
import { IReferralNotificationPort } from '../../ports/referral-notification.port';
import {
  DomainEvent,
  ReferralRewardEarnedEvent,
} from '../../domain/events/vendor-referral.domain-events';

export class NotifyReferrerOnRewardHandler {
  constructor(
    private readonly notificationPort: IReferralNotificationPort,
    private readonly logger: Logger
  ) {}

  /** Dispatcher entry point. Narrow-guards the event type, then notifies. */
  handle = async (event: DomainEvent): Promise<void> => {
    if (!(event instanceof ReferralRewardEarnedEvent)) {
      // Defensive: only reward-earned events drive a referrer notification in v1.
      return;
    }

    const referrerVendorId = BigInt(event.vendorId);
    const referralId = this.parseReferralId(event.aggregateId);

    this.logger.info(
      {
        referrerVendorId: referrerVendorId.toString(),
        rewardKind: event.rewardKind,
        correlationId: event.metadata.correlationId,
      },
      'NotifyReferrerOnReward: handling ReferralRewardEarned'
    );

    await this.notificationPort.notifyRewardEarned({
      referrerVendorId,
      amount: event.amount,
      rewardKind: event.rewardKind,
      referralId,
      correlationId: event.metadata.correlationId,
    });
  };

  /** aggregateId is the referral id; tolerate non-numeric/unknown values. */
  private parseReferralId(aggregateId: string): bigint | null {
    if (!/^\d+$/.test(aggregateId)) return null;
    try {
      return BigInt(aggregateId);
    } catch {
      return null;
    }
  }
}
