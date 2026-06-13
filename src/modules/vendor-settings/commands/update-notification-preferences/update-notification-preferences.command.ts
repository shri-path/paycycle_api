/**
 * UpdateNotificationPreferencesCommand — replaces only the notificationPreferences blob.
 */
import { logger } from '@/infrastructure/logger/logger';
import { ValidationError } from '@/common/errors/app-error';
import { IVendorSettingsRepository } from '../../database/vendor-settings.repository.port';
import { VendorSettingsEntity } from '../../domain/vendor-settings.entity';
import { VendorSettingsMapper } from '../../vendor-settings.mapper';
import { VendorSettingsDto } from '../../vendor-settings.types';
import { InvalidNotificationPreferencesError } from '../../domain/vendor-settings.errors';

export interface UpdateNotificationPreferencesInput {
  vendorId: bigint;
  notificationPreferences: Record<string, unknown>;
  performedByUserId: bigint;
  correlationId?: string;
}

export class UpdateNotificationPreferencesCommand {
  constructor(private readonly repo: IVendorSettingsRepository) {}

  async execute(input: UpdateNotificationPreferencesInput): Promise<VendorSettingsDto> {
    const { vendorId, notificationPreferences, performedByUserId, correlationId } = input;
    const metadata = {
      correlationId: correlationId ?? 'unknown',
      userId: performedByUserId.toString(),
    };

    let pendingEvents: ReturnType<VendorSettingsEntity['pullEvents']> = [];

    const savedRow = await this.repo.transaction(async (tx) => {
      const existingRow = await this.repo.findByVendor(vendorId, tx);

      let entity: VendorSettingsEntity;
      if (existingRow) {
        entity = VendorSettingsMapper.toDomain(existingRow);
      } else {
        entity = VendorSettingsEntity.create({ vendorId });
      }

      try {
        entity.updateNotificationPreferences(notificationPreferences, metadata);
      } catch (err) {
        if (err instanceof InvalidNotificationPreferencesError) {
          throw new ValidationError(err.message);
        }
        throw err;
      }

      const row = await this.repo.upsert(entity, tx);
      pendingEvents = entity.pullEvents();
      return row;
    });

    for (const event of pendingEvents) {
      logger.info({ event: event.type, payload: event.payload }, 'Domain event emitted');
    }

    return VendorSettingsMapper.toResponse(savedRow);
  }
}
