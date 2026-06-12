import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { DailySupplyMapper } from '../delivery.domain';
import { IDeliveryRepository } from '../delivery.repository.port';
import { appToday, appYesterday } from '../delivery.shared';

export interface AutoMarkSweepResult {
  serviceDate: string;
  marked: number;
  scanned: number;
}

/**
 * Command: auto-confirm PENDING daily supplies as DELIVERED on behalf of the
 * vendor (actorRole = SYSTEM). Two cron windows use this:
 *  - 01:00 IST — yesterday's still-PENDING rows ("if nobody said otherwise,
 *    assume delivered").
 *  - 06:05 IST — today's PENDING rows that should have auto-confirmed at the
 *    06:00 cutoff. The schema carries no per-row time slot, so the morning sweep
 *    targets today's PENDING rows with quantity > 0.
 */
export class AutoMarkSweepCommand {
  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly logger: Logger
  ) {}

  /** Overnight sweep: yesterday's still-PENDING rows. */
  async sweepYesterday(now: Date = new Date()): Promise<AutoMarkSweepResult> {
    return this.sweep(appYesterday(now), {}, crypto.randomUUID());
  }

  /** Morning-cutoff sweep: today's PENDING rows with quantity > 0. */
  async sweepMorning(now: Date = new Date()): Promise<AutoMarkSweepResult> {
    return this.sweep(appToday(now), { minQuantity: 0 }, crypto.randomUUID());
  }

  /** Auto-confirm every PENDING row matching the service date / quantity filter. */
  async sweep(
    serviceDate: Date,
    options: { minQuantity?: number },
    correlationId: string
  ): Promise<AutoMarkSweepResult> {
    const iso = serviceDate.toISOString().slice(0, 10);
    const ids = await this.repository.findPendingIdsForDate(serviceDate, options);

    let marked = 0;
    if (ids.length > 0) {
      await this.repository.transaction(async (tx) => {
        const records = await this.repository.findByIds(ids, tx);
        for (const record of records) {
          const total = await this.repository.getExtraChargesTotal(record.id, tx);
          const entity = DailySupplyMapper.toDomain(record, total);
          if (!entity.autoMarkDelivered()) continue;
          const override = entity.consumePendingOverride();
          if (!override) continue;
          await this.repository.applyMark(entity, override, tx);
          marked += 1;
        }
      });
    }

    this.logger.info(
      { correlationId, serviceDate: iso, scanned: ids.length, marked },
      'AutoMarkSweepCommand: sweep complete'
    );
    return { serviceDate: iso, marked, scanned: ids.length };
  }
}
