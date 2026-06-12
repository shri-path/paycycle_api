/**
 * IVendorSettingsRepository — port (interface) for VendorSettings persistence.
 * Services depend on this interface, not the Prisma adapter.
 */
import { VendorSettingsEntity } from '../domain/vendor-settings.entity';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

export interface VendorSettingsRow {
  id: bigint;
  vendorId: bigint;
  autoMarkEnabled: boolean;
  autoSendBillsEnabled: boolean;
  autoSendBillsTime: string;
  notificationPreferences: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface IVendorSettingsRepository {
  findByVendor(vendorId: bigint, tx?: PrismaTransaction): Promise<VendorSettingsRow | null>;
  upsert(entity: VendorSettingsEntity, tx?: PrismaTransaction): Promise<VendorSettingsRow>;
  transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T>;
}
