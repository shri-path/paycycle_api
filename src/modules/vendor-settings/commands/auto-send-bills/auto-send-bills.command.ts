/**
 * AutoSendBillsCommand — used by the hourly cron on the last day of the month.
 * Queries vendors with autoSendBillsEnabled=true and matching hour, then sends bills.
 */
import { logger } from '@/infrastructure/logger/logger';
import { logErrorToFile } from '@/common/utils/log-error-to-file';
import { IBulkOperationRepository } from '../../database/bulk-operation.repository.port';
import { BulkOperationEntity } from '../../domain/bulk-operation/bulk-operation.entity';
import {
  BulkOperationTargetType,
  BulkOperationType,
} from '../../domain/bulk-operation/bulk-operation.types';
import { VendorSettingsReaderPort } from '../../ports/vendor-settings-reader.port';
import { BillNotificationPort } from '../../ports/bill-notification.port';

// Stub for monthly bill reader — real implementation is a future story
export interface MonthlyBillReaderPort {
  /** Return active customers for the vendor */
  activeCustomers(vendorId: bigint): Promise<{ customerId: bigint; phone: string; name: string }[]>;
  /** Format a bill text for a customer */
  formatBill(customer: { customerId: bigint; name: string }, month: string): string;
}

export interface AutoSendBillsInput {
  currentHour: number;
  correlationId?: string;
  systemUserId: bigint;
}

export class AutoSendBillsCommand {
  constructor(
    private readonly settingsReader: VendorSettingsReaderPort,
    private readonly bulkOpRepo: IBulkOperationRepository,
    private readonly billNotification: BillNotificationPort,
    private readonly monthlyBillReader: MonthlyBillReaderPort
  ) {}

  async execute(input: AutoSendBillsInput): Promise<void> {
    const { currentHour, correlationId, systemUserId } = input;
    const corrId = correlationId ?? 'cron-auto-send-bills';

    const vendorIds = await this.settingsReader.vendorsForAutoSend(currentHour);
    if (vendorIds.length === 0) {
      logger.info(
        { currentHour, correlationId: corrId },
        'AutoSendBills: no vendors to process this hour'
      );
      return;
    }

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    for (const vendorId of vendorIds) {
      const op = BulkOperationEntity.create({
        vendorId,
        operationType: BulkOperationType.SEND_REMINDERS,
        targetType: BulkOperationTargetType.ALL,
        metadata: { kind: 'auto-bill', month, currentHour },
        performedByUserId: systemUserId,
      });

      let savedOp: BulkOperationEntity;
      try {
        savedOp = await this.bulkOpRepo.insert(op);
        savedOp.start();
        await this.bulkOpRepo.save(savedOp);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        logErrorToFile(error, {
          correlationId: corrId,
          vendorId: vendorId.toString(),
          context: 'AutoSendBillsCommand.insert',
        });
        logger.error(
          { err: error, vendorId: vendorId.toString(), correlationId: corrId },
          'AutoSendBills: failed to create operation record'
        );
        continue;
      }

      let totalSent = 0;
      let delivered = 0;
      let failed = 0;

      try {
        const customers = await this.monthlyBillReader.activeCustomers(vendorId);

        for (const c of customers) {
          const text = this.monthlyBillReader.formatBill(
            { customerId: c.customerId, name: c.name },
            month
          );
          totalSent++;

          let sent = await this.billNotification.sendBill(c.phone, text);
          if (!sent) {
            // Retry once
            sent = await this.billNotification.sendBill(c.phone, text);
          }
          if (sent) {
            delivered++;
          } else {
            failed++;
            logger.warn(
              {
                customerId: c.customerId.toString(),
                vendorId: vendorId.toString(),
                correlationId: corrId,
              },
              'AutoSendBills: failed to send bill to customer'
            );
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

        logger.info(
          { vendorId: vendorId.toString(), totalSent, delivered, failed, correlationId: corrId },
          'AutoSendBills: completed for vendor'
        );
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        savedOp.fail(error.message, { correlationId: corrId });
        await this.bulkOpRepo.save(savedOp).catch(() => undefined);

        logErrorToFile(error, {
          correlationId: corrId,
          vendorId: vendorId.toString(),
          context: 'AutoSendBillsCommand.process',
        });
        logger.error(
          { err: error, vendorId: vendorId.toString(), correlationId: corrId },
          'AutoSendBills: processing failed for vendor'
        );
      }
    }
  }
}
