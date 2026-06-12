/**
 * VendorSettingsMapper — three-way mapper.
 * toDomain: DB row → Entity
 * toPersistence: Entity → DB create/update input
 * toResponse: Entity/Row → DTO (whitelist)
 */
import { VendorSettings } from '@prisma/client';
import { VendorSettingsEntity } from './domain/vendor-settings.entity';
import { VendorSettingsRow } from './database/vendor-settings.repository.port';
import { VendorSettingsDto } from './vendor-settings.types';

export class VendorSettingsMapper {
  /** Convert Prisma raw record to a plain VendorSettingsRow (no Prisma types leaked). */
  static toRow(record: VendorSettings): VendorSettingsRow {
    return {
      id: record.id,
      vendorId: record.vendorId,
      autoMarkEnabled: record.autoMarkEnabled,
      autoSendBillsEnabled: record.autoSendBillsEnabled,
      autoSendBillsTime: record.autoSendBillsTime,
      notificationPreferences: record.notificationPreferences as Record<string, unknown>,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: record.deletedAt,
    };
  }

  /** DB row → Domain entity. */
  static toDomain(row: VendorSettingsRow): VendorSettingsEntity {
    return VendorSettingsEntity.fromPersistence({
      id: row.id,
      vendorId: row.vendorId,
      autoMarkEnabled: row.autoMarkEnabled,
      autoSendBillsEnabled: row.autoSendBillsEnabled,
      autoSendBillsTime: row.autoSendBillsTime,
      notificationPreferences: row.notificationPreferences,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /** Entity → Prisma create/update input. */
  static toPersistence(entity: VendorSettingsEntity): {
    vendorId: bigint;
    autoMarkEnabled: boolean;
    autoSendBillsEnabled: boolean;
    autoSendBillsTime: string;
    notificationPreferences: Record<string, unknown>;
  } {
    const props = entity.getProps();
    return {
      vendorId: props.vendorId,
      autoMarkEnabled: props.autoMarkEnabled,
      autoSendBillsEnabled: props.autoSendBillsEnabled,
      autoSendBillsTime: props.autoSendBillsTime,
      notificationPreferences: props.notificationPreferences,
    };
  }

  /** Entity/Row → Response DTO (whitelisted — no deletedAt). */
  static toResponse(row: VendorSettingsRow): VendorSettingsDto {
    return {
      id: row.id.toString(),
      vendorId: row.vendorId.toString(),
      autoMarkEnabled: row.autoMarkEnabled,
      autoSendBillsEnabled: row.autoSendBillsEnabled,
      autoSendBillsTime: row.autoSendBillsTime,
      notificationPreferences: row.notificationPreferences,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
