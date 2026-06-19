/**
 * Unit tests — ReferralEventDispatcher (US-15.3).
 * Verifies registration/fan-out, best-effort error swallowing, and that a failing
 * handler neither throws to the caller nor blocks other handlers.
 */
import { ReferralEventDispatcher } from '../../domain/events/referral-event-dispatcher';
import {
  ReferralRewardEarnedEvent,
  CreditRedeemedEvent,
} from '../../domain/events/vendor-referral.domain-events';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function rewardEvent(): ReferralRewardEarnedEvent {
  return new ReferralRewardEarnedEvent({
    aggregateId: '5',
    vendorId: '10',
    amount: 500,
    rewardKind: 'SIGNUP_BONUS',
    metadata: { correlationId: 'corr-1' },
  });
}

describe('ReferralEventDispatcher', () => {
  it('invokes a handler registered for the event name', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new ReferralEventDispatcher(logger).register(
      ReferralRewardEarnedEvent.name,
      handler
    );

    const event = rewardEvent();
    await dispatcher.publish(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('invokes all handlers registered for the same event', async () => {
    const h1 = jest.fn().mockResolvedValue(undefined);
    const h2 = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new ReferralEventDispatcher(logger)
      .register(ReferralRewardEarnedEvent.name, h1)
      .register(ReferralRewardEarnedEvent.name, h2);

    await dispatcher.publish(rewardEvent());

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it('does not invoke handlers registered for a different event', async () => {
    const rewardHandler = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new ReferralEventDispatcher(logger).register(
      ReferralRewardEarnedEvent.name,
      rewardHandler
    );

    await dispatcher.publish(
      new CreditRedeemedEvent({
        aggregateId: '99',
        vendorId: '10',
        amount: 100,
        redemptionType: 'subscription',
        metadata: { correlationId: 'corr-2' },
      })
    );

    expect(rewardHandler).not.toHaveBeenCalled();
  });

  it('resolves (does not throw) when there are no handlers', async () => {
    const dispatcher = new ReferralEventDispatcher(logger);
    await expect(dispatcher.publish(rewardEvent())).resolves.toBeUndefined();
  });

  it('swallows a throwing handler and still runs the others', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('transport down'));
    const succeeding = jest.fn().mockResolvedValue(undefined);
    const dispatcher = new ReferralEventDispatcher(logger)
      .register(ReferralRewardEarnedEvent.name, failing)
      .register(ReferralRewardEarnedEvent.name, succeeding);

    await expect(dispatcher.publish(rewardEvent())).resolves.toBeUndefined();
    expect(failing).toHaveBeenCalledTimes(1);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });
});
