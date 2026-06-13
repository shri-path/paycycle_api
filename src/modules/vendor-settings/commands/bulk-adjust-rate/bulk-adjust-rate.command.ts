/**
 * BulkAdjustRateCommand — adjusts the per-unit rate for subscriptions.
 * Skips subscriptions with a custom rate.
 */
import { logger } from '@/infrastructure/logger/logger';
import { logErrorToFile } from '@/common/utils/log-error-to-file';
import { UnprocessableEntityError } from '@/common/errors/app-error';
import { IVendorSettingsRepository } from '../../database/vendor-settings.repository.port';
import { IBulkOperationRepository } from '../../database/bulk-operation.repository.port';
import { VendorSettingsMapper } from '../../vendor-settings.mapper';
import { BulkOperationEntity } from '../../domain/bulk-operation/bulk-operation.entity';
import {
  BulkOperationStatus,
  BulkOperationTargetType,
  BulkOperationType,
} from '../../domain/bulk-operation/bulk-operation.types';
import { BulkOperationMapper } from '../../bulk-operation.mapper';
import { BulkRateWriterPort } from '../../ports/bulk-rate-writer.port';
import { BillNotificationPort } from '../../ports/bill-notification.port';
import { InvalidBulkDateError } from '../../domain/vendor-settings.errors';

export interface BulkAdjustRateInput {
  vendorId: bigint;
  subscriptionIds?: bigint[] | undefined;
  all?: boolean | undefined;
  newRate: number;
  effectiveDate: string;
  notifyCustomers?: boolean | undefined;
  performedByUserId: bigint;
  correlationId?: string | undefined;
}

export interface BulkAdjustRateResult {
  operationId: string;
  status: string;
  summary?: Record<string, unknown>;
  asyncProcessing?: boolean;
}

export class BulkAdjustRateCommand {
  constructor(
    private readonly settingsRepo: IVendorSettingsRepository,
    private readonly bulkOpRepo: IBulkOperationRepository,
    private readonly rateWriter: BulkRateWriterPort,
    private readonly billNotification: BillNotificationPort
  ) {}

  async execute(input: BulkAdjustRateInput): Promise<BulkAdjustRateResult> {
    const {
      vendorId,
      subscriptionIds,
      all,
      newRate,
      effectiveDate,
      notifyCustomers,
      performedByUserId,
      correlationId,
    } = input;
    const corrId = correlationId ?? 'unknown';

    // Validate effectiveDate is today or future
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (effectiveDate < today) {
      throw new UnprocessableEntityError(new InvalidBulkDateError(effectiveDate).message);
    }

    // Resolve concurrency limit
    const existingRow = await this.settingsRepo.findByVendor(vendorId);
    let concurrencyLimit = 50;
    if (existingRow) {
      const entity = VendorSettingsMapper.toDomain(existingRow);
      concurrencyLimit = entity.bulkOperationConcurrencyLimit;
    }

    // Resolve targets
    const mode = all ? 'all' : 'specific';
    const targetIds = mode === 'specific' ? (subscriptionIds ?? []) : undefined;
    const targets = await this.rateWriter.resolveSubscriptions(vendorId, mode, targetIds);
    const allSubIds = targets.map((t) => t.subscriptionId);

    const targetType = all ? BulkOperationTargetType.ALL : BulkOperationTargetType.SUBSCRIPTION;
    const newRateStr = newRate.toFixed(2);

    const op = BulkOperationEntity.create({
      vendorId,
      operationType: BulkOperationType.ADJUST_RATE,
      targetType,
      metadata: { newRate, effectiveDate, requestedCount: allSubIds.length },
      performedByUserId,
    });
    const savedOp = await this.bulkOpRepo.insert(op);

    if (allSubIds.length > concurrencyLimit) {
      logger.info(
        {
          operationId: savedOp.id.toString(),
          count: allSubIds.length,
          concurrencyLimit,
          correlationId: corrId,
        },
        'BulkAdjustRate: above concurrencyLimit, processing asynchronously'
      );
      return {
        operationId: savedOp.id.toString(),
        status: BulkOperationStatus.PENDING,
        asyncProcessing: true,
      };
    }

    try {
      savedOp.start();
      await this.bulkOpRepo.save(savedOp);

      // Group by supplyListId
      const byList = new Map<string, bigint[]>();
      for (const t of targets) {
        const key = t.supplyListId.toString();
        if (!byList.has(key)) byList.set(key, []);
        byList.get(key)!.push(t.subscriptionId);
      }

      let customersAffected = 0;
      let skipped = 0;
      let listsAffected = 0;
      let notified = 0;

      for (const [listIdStr, subIds] of byList) {
        const listId = BigInt(listIdStr);
        await this.rateWriter.updateListDefaultRate(listId, newRateStr, vendorId);
        listsAffected++;

        const updated = await this.rateWriter.updateSubsWithoutCustomRate(subIds, newRateStr);
        customersAffected += updated;

        const skippedCount = await this.rateWriter.countSubsWithCustomRate(subIds);
        skipped += skippedCount;

        if (notifyCustomers) {
          const affectedSubIds = subIds.slice(0, updated);
          const phones = await this.rateWriter.getCustomerPhones(affectedSubIds, vendorId);
          for (const { phone } of phones) {
            const text = `Dear customer, the rate has been updated to Rs ${newRate} per unit, effective ${effectiveDate}.`;
            const sent = await this.billNotification.sendReminder(phone, text);
            if (sent) notified++;
          }
        }
      }

      const oldRate = 0; // Not tracked in v1; rateChange shown as absolute new rate
      const summary: Record<string, unknown> = {
        listsAffected,
        customersAffected,
        skipped,
        rateChange: newRate - oldRate,
        monthlyImpact: 0, // Monthly delivery impact calculation is out of scope in v1
      };
      if (notifyCustomers) summary['notified'] = notified;

      savedOp.complete(summary, customersAffected, { correlationId: corrId });
      await this.bulkOpRepo.save(savedOp);

      const events = savedOp.pullEvents();
      for (const event of events) {
        logger.info(
          { event: event.type, payload: event.payload, correlationId: corrId },
          'Domain event emitted'
        );
      }

      return BulkOperationMapper.toCommandResponse(savedOp);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      savedOp.fail(error.message, { correlationId: corrId });
      await this.bulkOpRepo.save(savedOp).catch(() => undefined);

      logErrorToFile(error, {
        correlationId: corrId,
        operationId: savedOp.id.toString(),
        context: 'BulkAdjustRateCommand',
      });
      logger.error({ err: error, correlationId: corrId }, 'BulkAdjustRateCommand failed');

      throw new UnprocessableEntityError(error.message);
    }
  }
}
