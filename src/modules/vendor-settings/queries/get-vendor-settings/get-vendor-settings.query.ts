/**
 * GetVendorSettingsQuery — Query (read-only, no side effects).
 * Returns the current settings or a lazy-default object if none exist.
 */
import { IVendorSettingsRepository } from '../../database/vendor-settings.repository.port';
import { VendorSettingsEntity } from '../../domain/vendor-settings.entity';
import { VendorSettingsMapper } from '../../vendor-settings.mapper';
import { VendorSettingsDto } from '../../vendor-settings.types';

export class GetVendorSettingsQuery {
  constructor(private readonly repo: IVendorSettingsRepository) {}

  async execute(vendorId: bigint): Promise<VendorSettingsDto> {
    const row = await this.repo.findByVendor(vendorId);

    if (row) {
      return VendorSettingsMapper.toResponse(row);
    }

    // Lazy default — return defaults without persisting (GET is read-only)
    const defaultEntity = VendorSettingsEntity.create({ vendorId });
    const defaultProps = defaultEntity.getProps();
    return {
      id: '0',
      vendorId: vendorId.toString(),
      autoMarkEnabled: defaultProps.autoMarkEnabled,
      autoSendBillsEnabled: defaultProps.autoSendBillsEnabled,
      autoSendBillsTime: defaultProps.autoSendBillsTime,
      notificationPreferences: defaultProps.notificationPreferences,
      defaultCreditLimit: null,
      defaultCreditPeriodDays: null,
      bulkOperationConcurrencyLimit: defaultProps.bulkOperationConcurrencyLimit,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}
