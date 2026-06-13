/**
 * BulkMarkLeaveCommand — marks leave for a set of subscriptions on a given date.
 * Synchronous when targets <= concurrencyLimit; returns 202 status for larger sets.
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
import { BulkLeaveWriterPort } from '../../ports/bulk-leave-writer.port';
import { InvalidBulkDateError } from '../../domain/vendor-settings.errors';

export interface BulkMarkLeaveInput {
  vendorId: bigint;
  subscriptionIds?: bigint[] | undefined;
  all?: boolean | undefined;
  date: string;
  reason?: string | undefined;
  performedByUserId: bigint;
  correlationId?: string | undefined;
}

export interface BulkMarkLeaveResult {
  operationId: string;
  status: string;
  summary?: Record<string, unknown>;
  asyncProcessing?: boolean;
}

export class BulkMarkLeaveCommand {
  constructor(
    private readonly settingsRepo: IVendorSettingsRepository,
    private readonly bulkOpRepo: IBulkOperationRepository,
    private readonly leaveWriter: BulkLeaveWriterPort
  ) {}

  async execute(input: BulkMarkLeaveInput): Promise<BulkMarkLeaveResult> {
    const { vendorId, subscriptionIds, all, date, reason, performedByUserId, correlationId } =
      input;
    const corrId = correlationId ?? 'unknown';

    // Validate date is today or future
    const today = this.leaveWriter.today();
    if (date < today) {
      throw new UnprocessableEntityError(new InvalidBulkDateError(date).message);
    }

    // Resolve concurrency limit
    const existingRow = await this.settingsRepo.findByVendor(vendorId);
    let concurrencyLimit = 50;
    if (existingRow) {
      const entity = VendorSettingsMapper.toDomain(existingRow);
      concurrencyLimit = entity.bulkOperationConcurrencyLimit;
    }

    // Resolve target subscriptions
    const mode = all ? 'all' : 'specific';
    const targetIds = mode === 'specific' ? (subscriptionIds ?? []) : undefined;
    const resolvedIds = await this.leaveWriter.resolveSubscriptions(vendorId, mode, targetIds);

    const targetType = all ? BulkOperationTargetType.ALL : BulkOperationTargetType.SUBSCRIPTION;

    // Create BulkOperation record (PENDING)
    const op = BulkOperationEntity.create({
      vendorId,
      operationType: BulkOperationType.MARK_LEAVE,
      targetType,
      metadata: { date, reason: reason ?? null, requestedCount: resolvedIds.length },
      performedByUserId,
    });
    const savedOp = await this.bulkOpRepo.insert(op);

    // Return 202 if above concurrency limit
    if (resolvedIds.length > concurrencyLimit) {
      logger.info(
        {
          operationId: savedOp.id.toString(),
          count: resolvedIds.length,
          concurrencyLimit,
          correlationId: corrId,
        },
        'BulkMarkLeave: above concurrencyLimit, processing asynchronously'
      );
      return {
        operationId: savedOp.id.toString(),
        status: BulkOperationStatus.PENDING,
        asyncProcessing: true,
      };
    }

    // Synchronous processing
    try {
      savedOp.start();
      await this.bulkOpRepo.save(savedOp);

      let affected = 0;
      let skipped = 0;

      for (const subId of resolvedIds) {
        const hasCovering = await this.leaveWriter.hasCoveringLeave(subId, date);
        if (hasCovering) {
          skipped++;
          continue;
        }
        await this.leaveWriter.createLeave(
          subId,
          date,
          reason ?? null,
          'VENDOR_MARKED',
          performedByUserId
        );
        await this.leaveWriter.markDeliveriesLeave(subId, date);
        affected++;
      }

      const summary = {
        customersAffected: affected,
        days: 1,
        totalLeaves: affected,
        skipped,
        revenueImpact: 0, // Revenue impact calculation is out of scope in v1
      };

      savedOp.complete(summary, affected, { correlationId: corrId });
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
        context: 'BulkMarkLeaveCommand',
      });
      logger.error({ err: error, correlationId: corrId }, 'BulkMarkLeaveCommand failed');

      throw new UnprocessableEntityError(error.message);
    }
  }
}
