import { CustomerCreditSettingsEntity } from '../domain/customer-credit-settings.entity';

export interface ICreditSettingsRepository {
  findByCustomer(customerId: bigint): Promise<CustomerCreditSettingsEntity | null>;
  upsert(entity: CustomerCreditSettingsEntity): Promise<CustomerCreditSettingsEntity>;
}
