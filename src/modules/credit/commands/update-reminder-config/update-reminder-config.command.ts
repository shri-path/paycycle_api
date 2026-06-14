import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { IReminderConfigRepository } from '../../database/reminder-config.repository.port';
import { ReminderConfigEntity } from '../../domain/reminder-config.entity';
import { ReminderConfigUpdatedEvent } from '../../domain/events/reminder-config-updated.domain-event';
import { CreditMapper } from '../../credit.mapper';

export interface UpdateReminderConfigInput {
  vendorId: bigint;
  autoRemindersEnabled?: boolean;
  schedule3Days?: boolean;
  schedule15Days?: boolean;
  schedule30Days?: boolean;
  reminderTemplate?: string | null;
  excludedCustomerIds?: number[];
}

export class UpdateReminderConfigCommand {
  constructor(
    private readonly reminderConfigRepo: IReminderConfigRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: UpdateReminderConfigInput) {
    const correlationId = randomUUID();
    this.logger.info(
      { correlationId, vendorId: input.vendorId.toString() },
      'UpdateReminderConfig: start'
    );

    let entity = await this.reminderConfigRepo.findByVendor(input.vendorId);
    if (!entity) {
      entity = ReminderConfigEntity.create(input.vendorId);
    }

    entity.update({
      ...(input.autoRemindersEnabled !== undefined
        ? { autoRemindersEnabled: input.autoRemindersEnabled }
        : {}),
      ...(input.schedule3Days !== undefined ? { schedule3Days: input.schedule3Days } : {}),
      ...(input.schedule15Days !== undefined ? { schedule15Days: input.schedule15Days } : {}),
      ...(input.schedule30Days !== undefined ? { schedule30Days: input.schedule30Days } : {}),
      ...(input.reminderTemplate !== undefined ? { reminderTemplate: input.reminderTemplate } : {}),
      ...(input.excludedCustomerIds !== undefined
        ? { excludedCustomerIds: input.excludedCustomerIds }
        : {}),
    });

    entity = await this.reminderConfigRepo.upsert(entity);

    const props = entity.getProps();
    const event = new ReminderConfigUpdatedEvent(
      entity.id,
      input.vendorId,
      props.autoRemindersEnabled,
      { correlationId }
    );
    this.logger.info({ event, correlationId }, 'ReminderConfigUpdated event emitted');

    return CreditMapper.toReminderConfigResponse(entity);
  }
}
