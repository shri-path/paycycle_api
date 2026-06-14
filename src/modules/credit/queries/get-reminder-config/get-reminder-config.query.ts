import { IReminderConfigRepository } from '../../database/reminder-config.repository.port';
import { CreditMapper } from '../../credit.mapper';

export class GetReminderConfigQuery {
  constructor(private readonly reminderConfigRepo: IReminderConfigRepository) {}

  async execute(vendorId: bigint) {
    const entity = await this.reminderConfigRepo.findByVendor(vendorId);
    if (!entity) {
      return CreditMapper.defaultReminderConfigResponse();
    }
    return CreditMapper.toReminderConfigResponse(entity);
  }
}
