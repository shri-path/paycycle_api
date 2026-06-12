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
  createdAt: string;
  updatedAt: string;
}
