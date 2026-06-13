/**
 * vendor-settings.cron.ts — auto-send bills cron job.
 * Schedule: 0 * * * * (hourly, Asia/Kolkata)
 * Guard: ENABLE_CRON=true env flag
 * Logic: on last day of month, for each vendor with autoSendBillsEnabled + matching hour
 *        → AutoSendBillsCommand
 */
import cron from 'node-cron';
import { logger } from '@/infrastructure/logger/logger';
import { logErrorToFile } from '@/common/utils/log-error-to-file';
import { BulkOperationRepository } from './database/bulk-operation.repository';
import { VendorSettingsReaderAdapter } from './adapters/vendor-settings-reader.adapter';
import { BillNotificationLogAdapter } from './adapters/bill-notification-log.adapter';
import {
  AutoSendBillsCommand,
  MonthlyBillReaderPort,
} from './commands/auto-send-bills/auto-send-bills.command';

// Stub monthly bill reader — replace with real billing module adapter in a future story
const stubMonthlyBillReader: MonthlyBillReaderPort = {
  activeCustomers(
    _vendorId: bigint
  ): Promise<{ customerId: bigint; phone: string; name: string }[]> {
    return Promise.resolve([]);
  },
  formatBill(customer: { customerId: bigint; name: string }, month: string): string {
    return `Dear ${customer.name}, your bill for ${month} is ready. Please contact your vendor for details.`;
  },
};

function isLastDayOfMonth(): boolean {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.getDate() === 1;
}

function currentHourIST(): number {
  return parseInt(
    new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }),
    10
  );
}

async function runAutoSendBills(): Promise<void> {
  if (!isLastDayOfMonth()) {
    return;
  }

  const currentHour = currentHourIST();
  const correlationId = `cron-auto-send-bills-${new Date().toISOString()}`;

  logger.info({ currentHour, correlationId }, 'VendorSettings cron: auto-send-bills tick');

  const settingsReader = new VendorSettingsReaderAdapter();
  const bulkOpRepo = new BulkOperationRepository();
  const billNotification = new BillNotificationLogAdapter();

  // System user (id=1) for cron-triggered operations
  const systemUserId = 1n;

  const cmd = new AutoSendBillsCommand(
    settingsReader,
    bulkOpRepo,
    billNotification,
    stubMonthlyBillReader
  );

  try {
    await cmd.execute({ currentHour, correlationId, systemUserId });
    logger.info({ correlationId }, 'VendorSettings cron: auto-send-bills completed');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logErrorToFile(error, { correlationId, context: 'vendor-settings.cron' });
    logger.error({ err: error, correlationId }, 'VendorSettings cron: auto-send-bills failed');
  }
}

export function registerVendorSettingsCron(): void {
  if (process.env['ENABLE_CRON'] !== 'true') {
    logger.info('VendorSettings cron: disabled (ENABLE_CRON != true)');
    return;
  }

  // Hourly tick
  cron.schedule(
    '0 * * * *',
    () => {
      void runAutoSendBills();
    },
    {
      timezone: 'Asia/Kolkata',
    }
  );

  logger.info('VendorSettings cron: registered (0 * * * *, Asia/Kolkata)');
}
