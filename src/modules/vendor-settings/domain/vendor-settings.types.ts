/**
 * Domain types for the VendorSettings bounded context.
 * Framework-free: no Prisma, Express, or Pino imports.
 */

export interface VendorSettingsProps {
  vendorId: bigint;
  autoMarkEnabled: boolean;
  autoSendBillsEnabled: boolean;
  autoSendBillsTime: string; // "HH:mm"
  notificationPreferences: Record<string, unknown>;
}

export interface VendorSettingsCreateProps {
  vendorId: bigint;
  autoMarkEnabled?: boolean;
  autoSendBillsEnabled?: boolean;
  autoSendBillsTime?: string;
  notificationPreferences?: Record<string, unknown>;
}

export interface VendorSettingsPatch {
  autoMarkEnabled?: boolean;
  autoSendBillsEnabled?: boolean;
  autoSendBillsTime?: string;
  notificationPreferences?: Record<string, unknown>;
}
