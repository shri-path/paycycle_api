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
  // US-011
  defaultCreditLimit: string | null; // Decimal string, e.g. "2000.00"
  defaultCreditPeriodDays: number | null; // integer 1..365
  bulkOperationConcurrencyLimit: number; // integer 1..500, default 50
}

export interface VendorSettingsCreateProps {
  vendorId: bigint;
  autoMarkEnabled?: boolean;
  autoSendBillsEnabled?: boolean;
  autoSendBillsTime?: string;
  notificationPreferences?: Record<string, unknown>;
  // US-011
  defaultCreditLimit?: string | null;
  defaultCreditPeriodDays?: number | null;
  bulkOperationConcurrencyLimit?: number;
}

export interface VendorSettingsPatch {
  autoMarkEnabled?: boolean;
  autoSendBillsEnabled?: boolean;
  autoSendBillsTime?: string;
  notificationPreferences?: Record<string, unknown>;
  // US-011
  defaultCreditLimit?: string | null;
  defaultCreditPeriodDays?: number | null;
  bulkOperationConcurrencyLimit?: number;
}
