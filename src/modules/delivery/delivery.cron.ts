import crypto from 'crypto';
import cron, { ScheduledTask } from 'node-cron';
import { Logger } from '@/infrastructure/logger/logger';
import { DeliveryReader } from './delivery.reader';
import { GenerateDailySuppliesCommand } from './commands/generate-daily-supplies.command';
import { AutoMarkSweepCommand } from './commands/auto-mark-sweep.command';
import { appToday } from './delivery.shared';

/**
 * Registers the daily delivery cron jobs (OQ-7). In-process node-cron, gated
 * behind ENABLE_CRON=true so multi-instance deploys do not double-run and CI
 * stays off. The manual /deliveries/generate endpoint covers tests/ops.
 *
 * Jobs (all Asia/Kolkata):
 *  - 00:00 — generate today's daily supplies for every vendor.
 *  - 01:00 — auto-mark yesterday's still-PENDING supplies DELIVERED (SYSTEM).
 *  - 06:05 — auto-mark today's PENDING supplies (qty > 0) DELIVERED (SYSTEM)
 *            at the morning cutoff.
 */
export function registerDeliveryCron(
  generate: GenerateDailySuppliesCommand,
  autoMarkSweep: AutoMarkSweepCommand,
  reader: DeliveryReader,
  logger: Logger
): ScheduledTask[] {
  if (process.env['ENABLE_CRON'] !== 'true') {
    logger.info('Delivery cron disabled (set ENABLE_CRON=true to enable)');
    return [];
  }

  const tz = 'Asia/Kolkata';

  // 00:00 — generate today's daily supplies for every vendor.
  const generateJob = cron.schedule(
    '0 0 * * *',
    () => {
      void runGeneration(generate, reader, logger);
    },
    { timezone: tz }
  );

  // 01:00 — auto-confirm yesterday's still-PENDING supplies.
  const overnightSweepJob = cron.schedule(
    '0 1 * * *',
    () => {
      void runOvernightSweep(autoMarkSweep, logger);
    },
    { timezone: tz }
  );

  // 06:05 — auto-confirm today's morning-window PENDING supplies.
  const morningSweepJob = cron.schedule(
    '5 6 * * *',
    () => {
      void runMorningSweep(autoMarkSweep, logger);
    },
    { timezone: tz }
  );

  logger.info(
    'Delivery cron registered (generation 00:00, overnight sweep 01:00, morning sweep 06:05 Asia/Kolkata)'
  );
  return [generateJob, overnightSweepJob, morningSweepJob];
}

async function runGeneration(
  generate: GenerateDailySuppliesCommand,
  reader: DeliveryReader,
  logger: Logger
): Promise<void> {
  const correlationId = crypto.randomUUID();
  const date = appToday();
  try {
    const vendorIds = await reader.getVendorIdsWithActiveSubscriptions();
    let generated = 0;
    for (const vendorId of vendorIds) {
      const result = await generate.generateForVendor(vendorId, date, correlationId);
      generated += result.generated;
    }
    logger.info(
      {
        correlationId,
        vendors: vendorIds.length,
        generated,
        date: date.toISOString().slice(0, 10),
      },
      'Delivery cron: generation sweep complete'
    );
  } catch (error) {
    logger.error({ err: error, correlationId }, 'Delivery cron: generation sweep failed');
  }
}

async function runOvernightSweep(
  autoMarkSweep: AutoMarkSweepCommand,
  logger: Logger
): Promise<void> {
  const correlationId = crypto.randomUUID();
  logger.info({ correlationId }, 'Delivery cron: overnight auto-mark sweep started');
  try {
    const result = await autoMarkSweep.sweepYesterday();
    logger.info({ correlationId, ...result }, 'Delivery cron: overnight auto-mark sweep complete');
  } catch (error) {
    logger.error({ err: error, correlationId }, 'Delivery cron: overnight auto-mark sweep failed');
  }
}

async function runMorningSweep(autoMarkSweep: AutoMarkSweepCommand, logger: Logger): Promise<void> {
  const correlationId = crypto.randomUUID();
  logger.info({ correlationId }, 'Delivery cron: morning auto-mark sweep started');
  try {
    const result = await autoMarkSweep.sweepMorning();
    logger.info({ correlationId, ...result }, 'Delivery cron: morning auto-mark sweep complete');
  } catch (error) {
    logger.error({ err: error, correlationId }, 'Delivery cron: morning auto-mark sweep failed');
  }
}
