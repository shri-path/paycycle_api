/**
 * Subscription cron jobs — gated behind ENABLE_CRON=true.
 *
 * Jobs (all Asia/Kolkata):
 *  - 01:00 — expire or auto-renew subscriptions due today.
 *  - 09:00 — log renewal reminders for subscriptions expiring in <= 7 days (log-stub).
 */
import crypto from 'crypto';
import cron, { ScheduledTask } from 'node-cron';
import { Logger } from '@/infrastructure/logger/logger';
import { ExpireOrRenewDueCommand } from './commands/expire-or-renew-due/expire-or-renew-due.command';
import { ISubscriptionRepository } from './database/subscription.repository.port';

export function registerSubscriptionCron(
  expireOrRenewDue: ExpireOrRenewDueCommand,
  subscriptionRepo: ISubscriptionRepository,
  logger: Logger
): ScheduledTask[] {
  if (process.env['ENABLE_CRON'] !== 'true') {
    logger.info('Subscription cron disabled (set ENABLE_CRON=true to enable)');
    return [];
  }

  const tz = 'Asia/Kolkata';

  // 01:00 — expire or auto-renew due subscriptions
  const expiryJob = cron.schedule(
    '0 1 * * *',
    () => {
      void runExpireOrRenew(expireOrRenewDue, logger);
    },
    { timezone: tz }
  );

  // 09:00 — renewal reminders for subscriptions expiring in <= 7 days
  const reminderJob = cron.schedule(
    '0 9 * * *',
    () => {
      void runRenewalReminders(subscriptionRepo, logger);
    },
    { timezone: tz }
  );

  logger.info('Subscription cron registered (expire/renew 01:00, reminders 09:00 Asia/Kolkata)');
  return [expiryJob, reminderJob];
}

async function runExpireOrRenew(
  expireOrRenewDue: ExpireOrRenewDueCommand,
  logger: Logger
): Promise<void> {
  const correlationId = crypto.randomUUID();
  logger.info({ correlationId }, 'Subscription cron: expire/auto-renew sweep started');
  try {
    const today = new Date();
    const result = await expireOrRenewDue.run(today);
    logger.info(
      { correlationId, ...result },
      'Subscription cron: expire/auto-renew sweep complete'
    );
  } catch (error) {
    logger.error(
      { err: error, correlationId },
      'Subscription cron: expire/auto-renew sweep failed'
    );
  }
}

async function runRenewalReminders(
  subscriptionRepo: ISubscriptionRepository,
  logger: Logger
): Promise<void> {
  const correlationId = crypto.randomUUID();
  logger.info({ correlationId }, 'Subscription cron: renewal reminder check started');
  try {
    const today = new Date();
    const sevenDaysOut = new Date(today);
    sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

    // Find subscriptions with nextBillingDate within the next 7 days
    // We reuse findDueSubscriptions for subscriptions expiring soon (where nextBillingDate <= sevenDaysOut)
    const due = await subscriptionRepo.findDueSubscriptions(sevenDaysOut);

    // Filter to only those that expire in future (not today) for reminder purposes
    const expiringSoon = due.filter((s) => s.nextBillingDate !== null && s.nextBillingDate > today);

    for (const sub of expiringSoon) {
      logger.info(
        {
          correlationId,
          vendorId: sub.vendorId.toString(),
          subscriptionId: sub.id.toString(),
          nextBillingDate: sub.nextBillingDate?.toISOString().substring(0, 10),
          autoRenewal: sub.autoRenewal,
        },
        'Subscription cron: renewal reminder (notification: log-stub)'
      );
    }

    logger.info(
      { correlationId, count: expiringSoon.length },
      'Subscription cron: renewal reminder check complete'
    );
  } catch (error) {
    logger.error({ err: error, correlationId }, 'Subscription cron: renewal reminder check failed');
  }
}
