/**
 * UpdateVendorSettingsCommand — Command (mutates state, returns DTO).
 * Upsert semantics: creates defaults then applies patch on first call.
 * Emits VendorSettingsUpdatedEvent after successful persistence.
 */
import { logger } from '@/infrastructure/logger/logger';
import { IVendorSettingsRepository } from '../../database/vendor-settings.repository.port';
import { VendorSettingsEntity } from '../../domain/vendor-settings.entity';
import { VendorSettingsMapper } from '../../vendor-settings.mapper';
import { VendorSettingsDto } from '../../vendor-settings.types';
import { VendorSettingsPatch } from '../../domain/vendor-settings.types';

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

    const savedRow = await this.repo.transaction(async (tx) => {
      const existingRow = await this.repo.findByVendor(vendorId, tx);

      let entity: VendorSettingsEntity;
      if (existingRow) {
        entity = VendorSettingsMapper.toDomain(existingRow);
      } else {
        // Lazy create with defaults
        entity = VendorSettingsEntity.create({ vendorId });
      }

      entity.update(patch, metadata);

      return this.repo.upsert(entity, tx);
    });

    // Publish domain events (fire-and-forget log — no synchronous bus in v1)
    const tempEntity = VendorSettingsMapper.toDomain(savedRow);
    const events = tempEntity.pullEvents();
    for (const event of events) {
      logger.info({ event: event.type, payload: event.payload }, 'Domain event emitted');
    }

    return VendorSettingsMapper.toResponse(savedRow);
  }
}
