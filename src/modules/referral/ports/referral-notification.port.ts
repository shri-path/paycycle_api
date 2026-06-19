/**
 * ReferralNotificationPort — Strategy port for notifying a referrer that they
 * earned a referral reward (US-15.3 / US-014 AC "Send notification to referrer").
 *
 * Framework-free: no Express/Prisma imports. The composition root selects an
 * implementation (log stub in v1; a real WhatsApp/push/queue adapter later).
 */

/** Payload for a referrer reward-earned notification. Per-tenant by referrerVendorId. */
export interface ReferrerRewardNotification {
  /** The referring vendor who earned the reward — the recipient AND the tenant key. */
  referrerVendorId: bigint;
  /** Reward amount in rupees. */
  amount: number;
  /** Reward kind (e.g. SIGNUP_BONUS, MILESTONE_10, REVENUE_SHARE). */
  rewardKind: string;
  /** Originating vendor-referral id, when known. */
  referralId: bigint | null;
  /** Correlates the notification with the originating request / cron run. */
  correlationId: string;
}

export interface IReferralNotificationPort {
  /** Stable id of the concrete transport (for logging/diagnostics). */
  id: string;
  /**
   * Notify the referrer that a reward was earned. Implementations MUST NOT throw
   * into the caller — a failed/unavailable transport is logged and swallowed so it
   * never fails the already-committed reward/ledger transaction.
   */
  notifyRewardEarned(input: ReferrerRewardNotification): Promise<void>;
}
