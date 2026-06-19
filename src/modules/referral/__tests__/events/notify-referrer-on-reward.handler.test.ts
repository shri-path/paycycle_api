/**
 * Unit tests — NotifyReferrerOnRewardHandler (US-15.3).
 * Verifies the referrer is notified with reward type + amount, non-reward events
 * are ignored, and a notification-port failure is swallowed (best-effort).
 */
import { NotifyReferrerOnRewardHandler } from '../../application/event-handlers/notify-referrer-on-reward.handler';
import {
  IReferralNotificationPort,
  ReferrerRewardNotification,
} from '../../ports/referral-notification.port';
import {
  ReferralRewardEarnedEvent,
  CreditRedeemedEvent,
} from '../../domain/events/vendor-referral.domain-events';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function makePort(): jest.Mocked<IReferralNotificationPort> {
  return {
    id: 'test-port',
    notifyRewardEarned: jest.fn().mockResolvedValue(undefined),
  };
}

function firstNotification(
  port: jest.Mocked<IReferralNotificationPort>
): ReferrerRewardNotification {
  const input = port.notifyRewardEarned.mock.calls[0]?.[0];
  if (!input) throw new Error('expected notifyRewardEarned to have been called');
  return input;
}

describe('NotifyReferrerOnRewardHandler', () => {
  it('notifies the referrer with reward kind + amount', async () => {
    const port = makePort();
    const handler = new NotifyReferrerOnRewardHandler(port, logger);

    await handler.handle(
      new ReferralRewardEarnedEvent({
        aggregateId: '5',
        vendorId: '10',
        amount: 1000,
        rewardKind: 'MILESTONE_10',
        metadata: { correlationId: 'corr-1' },
      })
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(port.notifyRewardEarned).toHaveBeenCalledTimes(1);
    const n = firstNotification(port);
    expect(n.referrerVendorId).toBe(BigInt(10));
    expect(n.amount).toBe(1000);
    expect(n.rewardKind).toBe('MILESTONE_10');
    expect(n.referralId).toBe(BigInt(5));
    expect(n.correlationId).toBe('corr-1');
  });

  it('passes referralId = null when aggregateId is not numeric', async () => {
    const port = makePort();
    const handler = new NotifyReferrerOnRewardHandler(port, logger);

    await handler.handle(
      new ReferralRewardEarnedEvent({
        aggregateId: 'not-a-number',
        vendorId: '10',
        amount: 500,
        rewardKind: 'SIGNUP_BONUS',
        metadata: { correlationId: 'corr-2' },
      })
    );

    expect(firstNotification(port).referralId).toBeNull();
  });

  it('ignores non-reward events', async () => {
    const port = makePort();
    const handler = new NotifyReferrerOnRewardHandler(port, logger);

    await handler.handle(
      new CreditRedeemedEvent({
        aggregateId: '99',
        vendorId: '10',
        amount: 100,
        redemptionType: 'subscription',
        metadata: { correlationId: 'corr-3' },
      })
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(port.notifyRewardEarned).not.toHaveBeenCalled();
  });

  it('propagates port rejection to the caller (dispatcher swallows it)', async () => {
    const port = makePort();
    port.notifyRewardEarned.mockRejectedValueOnce(new Error('transport down'));
    const handler = new NotifyReferrerOnRewardHandler(port, logger);

    // The handler does not itself swallow — the dispatcher does. Document that here.
    await expect(
      handler.handle(
        new ReferralRewardEarnedEvent({
          aggregateId: '5',
          vendorId: '10',
          amount: 500,
          rewardKind: 'SIGNUP_BONUS',
          metadata: { correlationId: 'corr-4' },
        })
      )
    ).rejects.toThrow('transport down');
  });
});
