/**
 * Unit tests — LogReferralNotificationAdapter (US-15.3).
 * The v1 log/stub transport must resolve without throwing for any input.
 */
import { LogReferralNotificationAdapter } from '../../database/referral-notification.adapter';

describe('LogReferralNotificationAdapter', () => {
  it('exposes a stable transport id', () => {
    expect(new LogReferralNotificationAdapter().id).toBe('referral-notify-log-stub');
  });

  it('resolves notifyRewardEarned without throwing', async () => {
    const adapter = new LogReferralNotificationAdapter();
    await expect(
      adapter.notifyRewardEarned({
        referrerVendorId: BigInt(10),
        amount: 500,
        rewardKind: 'SIGNUP_BONUS',
        referralId: BigInt(5),
        correlationId: 'corr-1',
      })
    ).resolves.toBeUndefined();
  });

  it('handles a null referralId', async () => {
    const adapter = new LogReferralNotificationAdapter();
    await expect(
      adapter.notifyRewardEarned({
        referrerVendorId: BigInt(10),
        amount: 1000,
        rewardKind: 'MILESTONE_10',
        referralId: null,
        correlationId: 'corr-2',
      })
    ).resolves.toBeUndefined();
  });
});
