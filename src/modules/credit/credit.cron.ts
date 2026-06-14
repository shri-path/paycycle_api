/**
 * Credit cron jobs — gated behind ENABLE_CRON=true.
 *
 * Jobs (Asia/Kolkata):
 *  - 08:00 — RunScheduledReminders: send reminders per vendor schedule config.
 *  - 06:00 — RunPrepaidBalanceCheck: check prepaid customers with low/zero advance.
 */
import crypto from 'crypto';
import cron, { ScheduledTask } from 'node-cron';
import { prisma } from '@/infrastructure/database/prisma.client';
import { Logger } from '@/infrastructure/logger/logger';
import { CreditBalanceAdapter } from './adapters/credit-balance.adapter';
import { CreditCustomerAdapter } from './adapters/credit-customer.adapter';
import { DeliveryControlAdapter } from './adapters/delivery-control.adapter';
import { ReminderNotificationLogAdapter } from './adapters/reminder-notification-log.adapter';
import { ReminderConfigRepository } from './database/reminder-config.repository';
import { PaymentReminderRepository } from './database/payment-reminder.repository';
import { SendBulkRemindersCommand } from './commands/send-bulk-reminders/send-bulk-reminders.command';
import { CreditTypeEnum, CreditBreachActionEnum, ReminderChannelEnum } from './domain/credit.types';
import { CustomerCreditBreachedEvent } from './domain/events/customer-credit-breached.domain-event';

export function registerCreditCron(logger: Logger): ScheduledTask[] {
  if (process.env['ENABLE_CRON'] !== 'true') {
    logger.info('Credit cron disabled (set ENABLE_CRON=true to enable)');
    return [];
  }

  const tz = 'Asia/Kolkata';

  // 08:00 — auto reminders per vendor schedule
  const remindersJob = cron.schedule(
    '0 8 * * *',
    () => {
      void runScheduledReminders(logger);
    },
    { timezone: tz }
  );

  // 06:00 — prepaid balance check
  const prepaidJob = cron.schedule(
    '0 6 * * *',
    () => {
      void runPrepaidBalanceCheck(logger);
    },
    { timezone: tz }
  );

  logger.info('Credit cron registered (reminders 08:00, prepaid check 06:00 Asia/Kolkata)');
  return [remindersJob, prepaidJob];
}

async function runScheduledReminders(logger: Logger): Promise<void> {
  const correlationId = crypto.randomUUID();
  logger.info({ correlationId }, 'Credit cron: scheduled reminders sweep started');

  try {
    const balanceAdapter = new CreditBalanceAdapter();
    const customerAdapter = new CreditCustomerAdapter();
    const notificationAdapter = new ReminderNotificationLogAdapter();
    const reminderRepo = new PaymentReminderRepository();
    const reminderConfigRepo = new ReminderConfigRepository();

    // Find vendors with autoRemindersEnabled
    const configs = await prisma.reminderConfig.findMany({
      where: { autoRemindersEnabled: true },
      select: { vendorId: true, schedule3Days: true, schedule15Days: true, schedule30Days: true },
    });

    const today = new Date();
    const dayOfMonth = today.getDate();

    let totalSent = 0,
      totalSkipped = 0,
      totalFailed = 0;

    for (const config of configs) {
      // Simple schedule check: run on days 3, 15, 30 of the month
      const shouldRun =
        (config.schedule3Days && dayOfMonth === 3) ||
        (config.schedule15Days && dayOfMonth === 15) ||
        (config.schedule30Days && dayOfMonth === 30);

      if (!shouldRun) continue;

      const sendCmd = new SendBulkRemindersCommand(
        reminderRepo,
        reminderConfigRepo,
        balanceAdapter,
        customerAdapter,
        notificationAdapter,
        logger
      );
      const result = await sendCmd.execute({ vendorId: config.vendorId, target: 'all_overdue' });
      totalSent += result.sent;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
    }

    logger.info(
      { correlationId, vendorCount: configs.length, totalSent, totalSkipped, totalFailed },
      'Credit cron: scheduled reminders sweep complete'
    );
  } catch (err) {
    logger.error({ err, correlationId }, 'Credit cron: scheduled reminders sweep failed');
  }
}

async function runPrepaidBalanceCheck(logger: Logger): Promise<void> {
  const correlationId = crypto.randomUUID();
  logger.info({ correlationId }, 'Credit cron: prepaid balance check started');

  try {
    const balanceAdapter = new CreditBalanceAdapter();
    const deliveryControl = new DeliveryControlAdapter();
    const notificationAdapter = new ReminderNotificationLogAdapter();

    // Find prepaid customers across all vendors
    const prepaidSettings = await prisma.customerCreditSettings.findMany({
      where: { creditType: CreditTypeEnum.PREPAID },
      include: {
        customer: {
          select: {
            id: true,
            phone: true,
            name: true,
            creditLimit: true,
            vendorCustomers: { select: { vendorId: true, deletedAt: true } },
          },
        },
      },
    });

    for (const setting of prepaidSettings) {
      const customer = setting.customer;
      const vendorCustomer = customer.vendorCustomers.find((vc) => !vc.deletedAt);
      if (!vendorCustomer) continue;

      const vendorId = vendorCustomer.vendorId;
      const balance = await balanceAdapter.getCustomerBalance(customer.id, vendorId);
      const minWarning = setting.minimumBalanceWarning
        ? Number(setting.minimumBalanceWarning.toString())
        : 0;

      // balance >= 0 means advance exhausted → pause
      if (balance >= 0) {
        await deliveryControl.pauseCustomer(customer.id, vendorId);
        const event = new CustomerCreditBreachedEvent(
          customer.id,
          vendorId,
          balance,
          Number(customer.creditLimit.toString()),
          CreditBreachActionEnum.PAUSE,
          { correlationId }
        );
        logger.warn(
          { event, correlationId },
          'Credit cron: prepaid advance exhausted — deliveries paused'
        );
      } else if (minWarning > 0 && Math.abs(balance) < minWarning) {
        // Low-balance alert (log-stub)
        await notificationAdapter.send({
          customerPhone: customer.phone,
          channel: ReminderChannelEnum.WHATSAPP,
          body: `Low balance alert for ${customer.name ?? 'customer'}. Remaining advance: ₹${Math.abs(balance).toFixed(2)}`,
          correlationId,
        });
      }
    }

    logger.info(
      { correlationId, checked: prepaidSettings.length },
      'Credit cron: prepaid balance check complete'
    );
  } catch (err) {
    logger.error({ err, correlationId }, 'Credit cron: prepaid balance check failed');
  }
}
