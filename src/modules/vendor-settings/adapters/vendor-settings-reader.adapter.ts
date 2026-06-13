/**
 * VendorSettingsReaderAdapter — Prisma implementation of VendorSettingsReaderPort.
 * Consumed by delivery module and cron.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { VendorSettingsReaderPort } from '../ports/vendor-settings-reader.port';

export class VendorSettingsReaderAdapter implements VendorSettingsReaderPort {
  async get(
    vendorId: bigint
  ): Promise<{ autoMarkEnabled: boolean; bulkOperationConcurrencyLimit: number }> {
    const row = await prisma.vendorSettings.findUnique({
      where: { vendorId, deletedAt: null },
      select: { autoMarkEnabled: true, bulkOperationConcurrencyLimit: true },
    });

    if (!row) {
      // Return domain defaults
      return { autoMarkEnabled: true, bulkOperationConcurrencyLimit: 50 };
    }

    return {
      autoMarkEnabled: row.autoMarkEnabled,
      bulkOperationConcurrencyLimit: row.bulkOperationConcurrencyLimit,
    };
  }

  async vendorsForAutoSend(currentHour: number): Promise<bigint[]> {
    const rows = await prisma.vendorSettings.findMany({
      where: {
        autoSendBillsEnabled: true,
        deletedAt: null,
      },
      select: { vendorId: true, autoSendBillsTime: true },
    });

    return rows
      .filter((r) => {
        const hour = parseInt(r.autoSendBillsTime.split(':')[0]!, 10);
        return hour === currentHour;
      })
      .map((r) => r.vendorId);
  }
}
