/**
 * Log/stub adapter for IReferralNotificationPort (US-15.3).
 *
 * v1 transport: emits a structured, per-tenant log line for every reward-earned
 * notification. This is intentionally NOT a no-op — the publish → handler → port
 * chain genuinely runs and produces an observable, testable record.
 *
 * DEFERRED (documented, not silent): real WhatsApp/SMS/push delivery and durable
 * persistence of notifications. The port is the seam — a
 * `WhatsAppReferralNotificationAdapter` (reusing the platform messaging service
 * behind `StubInviteMessageAdapter`) or a queue-backed transport drops in here
 * without changing any publish call site. Tracked as a future US-15.x follow-up,
 * same posture as the existing invite-message stub.
 */
import { logger } from '@/infrastructure/logger/logger';
import {
  IReferralNotificationPort,
  ReferrerRewardNotification,
} from '../ports/referral-notification.port';

export class LogReferralNotificationAdapter implements IReferralNotificationPort {
  readonly id = 'referral-notify-log-stub';

  notifyRewardEarned(input: ReferrerRewardNotification): Promise<void> {
    logger.info(
      {
        transport: this.id,
        referrerVendorId: input.referrerVendorId.toString(),
        amount: input.amount,
        rewardKind: input.rewardKind,
        referralId: input.referralId != null ? input.referralId.toString() : null,
        correlationId: input.correlationId,
      },
      'ReferralNotificationPort [STUB] — would notify referrer of earned reward'
    );
    return Promise.resolve();
  }
}
