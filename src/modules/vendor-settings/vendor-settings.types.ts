/**
 * Application/DTO types for VendorSettings.
 */

export interface VendorSettingsDto {
  id: string;
  vendorId: string;
  autoMarkEnabled: boolean;
  autoSendBillsEnabled: boolean;
  autoSendBillsTime: string;
  notificationPreferences: Record<string, unknown>;
  // US-011
  defaultCreditLimit: number | null;
  defaultCreditPeriodDays: number | null;
  bulkOperationConcurrencyLimit: number;
  createdAt: string;
  updatedAt: string;
}
