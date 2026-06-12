/**
 * UpdateVendorSettingsCommand — Command (mutates state, returns DTO).
 * Upsert semantics: creates defaults then applies patch on first call.
 * Emits VendorSettingsUpdatedEvent after successful persistence.
 */
import { logger } from '@/infrastructure/logger/logger';
import { ValidationError } from '@/common/errors/app-error';
import { IVendorSettingsRepository } from '../../database/vendor-settings.repository.port';
import { VendorSettingsEntity } from '../../domain/vendor-settings.entity';
import { VendorSettingsMapper } from '../../vendor-settings.mapper';
import { VendorSettingsDto } from '../../vendor-settings.types';
import { VendorSettingsPatch } from '../../domain/vendor-settings.types';
import {
  InvalidTimeOfDayError,
  InvalidNotificationPreferencesError,
} from '../../domain/vendor-settings.errors';
import { VendorSettingsUpdatedEvent } from '../../domain/events/vendor-settings-updated.domain-event';

export interface UpdateVendorSettingsInput {
  vendorId: bigint;
  patch: VendorSettingsPatch;
  performedByUserId: bigint;
  correlationId?: string;
}

export class UpdateVendorSettingsCommand {
  constructor(private readonly repo: IVendorSettingsRepository) {}

  async execute(input: UpdateVendorSettingsInput): Promise<VendorSettingsDto> {
    const { vendorId, patch, performedByUserId, correlationId } = input;
    const metadata = {
      correlationId: correlationId ?? 'unknown',
      userId: performedByUserId.toString(),
    };

    let pendingEvents: VendorSettingsUpdatedEvent[] = [];

    const savedRow = await this.repo.transaction(async (tx) => {
      const existingRow = await this.repo.findByVendor(vendorId, tx);

      let entity: VendorSettingsEntity;
      if (existingRow) {
        entity = VendorSettingsMapper.toDomain(existingRow);
      } else {
        // Lazy create with defaults
        entity = VendorSettingsEntity.create({ vendorId });
      }

      try {
        entity.update(patch, metadata);
      } catch (err) {
        if (
          err instanceof InvalidTimeOfDayError ||
          err instanceof InvalidNotificationPreferencesError
        ) {
          throw new ValidationError(err.message);
        }
        throw err;
      }

      const row = await this.repo.upsert(entity, tx);

      // Pull events from the entity that had update() called — not from a re-hydrated instance
      pendingEvents = entity.pullEvents();
      return row;
    });

    // Publish domain events (fire-and-forget log — no synchronous bus in v1)
    for (const event of pendingEvents) {
      logger.info({ event: event.type, payload: event.payload }, 'Domain event emitted');
    }

    return VendorSettingsMapper.toResponse(savedRow);
  }
}
