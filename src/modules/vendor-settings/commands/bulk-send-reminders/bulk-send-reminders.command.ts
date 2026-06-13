/**
 * BulkSendRemindersCommand — sends payment reminders to customers.
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
import { ReminderTargetPort } from '../../ports/reminder-target.port';
import { BillNotificationPort } from '../../ports/bill-notification.port';

const DEFAULT_TEMPLATE = 'Hi, you have a pending balance. Please pay at your earliest convenience.';

export interface BulkSendRemindersInput {
  vendorId: bigint;
  customerIds?: bigint[] | undefined;
  all?: boolean | undefined;
  messageTemplate?: string | undefined;
  performedByUserId: bigint;
  correlationId?: string | undefined;
}

export interface BulkSendRemindersResult {
  operationId: string;
  status: string;
  summary?: Record<string, unknown>;
  asyncProcessing?: boolean;
}

export class BulkSendRemindersCommand {
  constructor(
    private readonly settingsRepo: IVendorSettingsRepository,
    private readonly bulkOpRepo: IBulkOperationRepository,
    private readonly reminderTarget: ReminderTargetPort,
    private readonly billNotification: BillNotificationPort
  ) {}

  async execute(input: BulkSendRemindersInput): Promise<BulkSendRemindersResult> {
    const { vendorId, customerIds, all, messageTemplate, performedByUserId, correlationId } = input;
    const corrId = correlationId ?? 'unknown';
    const template = messageTemplate ?? DEFAULT_TEMPLATE;

    // Resolve concurrency limit
    const existingRow = await this.settingsRepo.findByVendor(vendorId);
    let concurrencyLimit = 50;
    if (existingRow) {
      const entity = VendorSettingsMapper.toDomain(existingRow);
      concurrencyLimit = entity.bulkOperationConcurrencyLimit;
    }

    // Resolve targets
    const targets = await this.reminderTarget.resolveCustomers(vendorId, customerIds, all);
    const targetType = all ? BulkOperationTargetType.ALL : BulkOperationTargetType.CUSTOMER;

    const op = BulkOperationEntity.create({
      vendorId,
      operationType: BulkOperationType.SEND_REMINDERS,
      targetType,
      metadata: { requestedCount: targets.length, hasCustomTemplate: !!messageTemplate },
      performedByUserId,
    });
    const savedOp = await this.bulkOpRepo.insert(op);

    if (targets.length > concurrencyLimit) {
      logger.info(
        {
          operationId: savedOp.id.toString(),
          count: targets.length,
          concurrencyLimit,
          correlationId: corrId,
        },
        'BulkSendReminders: above concurrencyLimit, processing asynchronously'
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

      let totalSent = 0;
      let delivered = 0;
      let failed = 0;

      for (const target of targets) {
        totalSent++;
        const sent = await this.billNotification.sendReminder(target.phone, template);
        if (sent) {
          delivered++;
        } else {
          // Retry once
          const retry = await this.billNotification.sendReminder(target.phone, template);
          if (retry) {
            delivered++;
          } else {
            failed++;
          }
        }
      }

      const summary = { totalSent, delivered, failed };

      savedOp.complete(summary, delivered, { correlationId: corrId });
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
        context: 'BulkSendRemindersCommand',
      });
      logger.error({ err: error, correlationId: corrId }, 'BulkSendRemindersCommand failed');

      throw new UnprocessableEntityError(error.message);
    }
  }
}
