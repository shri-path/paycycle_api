/**
 * Shared, process-wide referral event dispatcher (US-15.3).
 *
 * A single dispatcher instance is shared across every publish site (redeem command,
 * signup facade, reward/qualify/clawback crons) and is pre-wired with the
 * notification handler. Lives in its own module — exactly like
 * `dashboard-cache.instance.ts` — to avoid an import cycle between the composition
 * root (referral.routes.ts), the facade, and the cron registration.
 *
 * v1 transport is the log/stub notification adapter; see
 * `referral-notification.adapter.ts` for the documented deferral of a real transport.
 */
import { logger } from '@/infrastructure/logger/logger';
import { ReferralEventDispatcher } from '../domain/events/referral-event-dispatcher';
import { ReferralRewardEarnedEvent } from '../domain/events/vendor-referral.domain-events';
import { LogReferralNotificationAdapter } from './referral-notification.adapter';
import { NotifyReferrerOnRewardHandler } from '../application/event-handlers/notify-referrer-on-reward.handler';

const notificationAdapter = new LogReferralNotificationAdapter();
const notifyReferrerOnReward = new NotifyReferrerOnRewardHandler(notificationAdapter, logger);

export const referralEvents = new ReferralEventDispatcher(logger).register(
  ReferralRewardEarnedEvent.name,
  notifyReferrerOnReward.handle
);
