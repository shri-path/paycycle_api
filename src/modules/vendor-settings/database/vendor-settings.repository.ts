/**
 * VendorSettingsRepository — Prisma adapter for IVendorSettingsRepository.
 */
import { Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import { VendorSettingsEntity } from '../domain/vendor-settings.entity';
import { IVendorSettingsRepository, VendorSettingsRow } from './vendor-settings.repository.port';
import { VendorSettingsMapper } from '../vendor-settings.mapper';

export class VendorSettingsRepository implements IVendorSettingsRepository {
  async findByVendor(vendorId: bigint, tx?: PrismaTransaction): Promise<VendorSettingsRow | null> {
    const client = tx ?? prisma;
    const row = await client.vendorSettings.findUnique({
      where: { vendorId, deletedAt: null },
    });
    if (!row) return null;
    return VendorSettingsMapper.toRow(row);
  }

  async upsert(entity: VendorSettingsEntity, tx?: PrismaTransaction): Promise<VendorSettingsRow> {
    const client = tx ?? prisma;
    const data = VendorSettingsMapper.toPersistence(entity);

    try {
      const row = await client.vendorSettings.upsert({
        where: { vendorId: data.vendorId },
        create: {
          vendorId: data.vendorId,
          autoMarkEnabled: data.autoMarkEnabled,
          autoSendBillsEnabled: data.autoSendBillsEnabled,
          autoSendBillsTime: data.autoSendBillsTime,
          notificationPreferences: data.notificationPreferences as Prisma.InputJsonValue,
        },
        update: {
          autoMarkEnabled: data.autoMarkEnabled,
          autoSendBillsEnabled: data.autoSendBillsEnabled,
          autoSendBillsTime: data.autoSendBillsTime,
          notificationPreferences: data.notificationPreferences as Prisma.InputJsonValue,
        },
      });
      return VendorSettingsMapper.toRow(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Vendor settings already exist for this vendor');
      }
      throw error;
    }
  }

  async transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }
}
