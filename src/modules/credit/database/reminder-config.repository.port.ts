import { ReminderConfigEntity } from '../domain/reminder-config.entity';

export interface IReminderConfigRepository {
  findByVendor(vendorId: bigint): Promise<ReminderConfigEntity | null>;
  upsert(entity: ReminderConfigEntity): Promise<ReminderConfigEntity>;
}
