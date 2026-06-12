import crypto from 'crypto';
import cron, { ScheduledTask } from 'node-cron';
import { Logger } from '@/infrastructure/logger/logger';
import { DeliveryReader } from './delivery.reader';
import { DeliveryService, appToday } from './delivery.service';

/**
 * Registers the daily delivery-generation cron jobs (OQ-7). In-process node-cron,
 * gated behind ENABLE_CRON=true so multi-instance deploys do not double-run and
 * CI stays off. The manual /deliveries/generate endpoint covers tests/ops.
 */
export function registerDeliveryCron(
  service: DeliveryService,
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
      void runGeneration(service, reader, logger);
    },
    { timezone: tz }
  );

  logger.info('Delivery cron registered (generation 00:00 Asia/Kolkata)');
  return [generateJob];
}

async function runGeneration(
  service: DeliveryService,
  reader: DeliveryReader,
  logger: Logger
): Promise<void> {
  const correlationId = crypto.randomUUID();
  const date = appToday();
  try {
    const vendorIds = await reader.getVendorIdsWithActiveSubscriptions();
    let generated = 0;
    for (const vendorId of vendorIds) {
      const result = await service.generateForVendor(vendorId, date, correlationId);
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
