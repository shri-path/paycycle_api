/**
 * VendorSettingsReaderPort — read interface consumed by cross-module callers
 * (e.g. delivery module's auto-mark sweep). Keeps delivery from importing the
 * vendor-settings repository directly.
 */

export interface VendorSettingsReaderPort {
  /** Get lightweight settings for a vendor. Returns defaults when no row exists. */
  get(
    vendorId: bigint
  ): Promise<{ autoMarkEnabled: boolean; bulkOperationConcurrencyLimit: number }>;

  /**
   * Return vendorIds whose autoSendBillsEnabled = true and whose
   * autoSendBillsTime hour (Asia/Kolkata) equals currentHour (0–23).
   */
  vendorsForAutoSend(currentHour: number): Promise<bigint[]>;
}
