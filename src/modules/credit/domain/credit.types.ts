/**
 * Domain types for the Credit bounded context.
 * No framework imports — pure TypeScript.
 */

// ── Enums (mirrored from Prisma but framework-free) ──────────────────────────

export enum CreditTypeEnum {
  NORMAL = 'NORMAL',
  PREPAID = 'PREPAID',
  UNLIMITED = 'UNLIMITED',
}

export enum CreditBreachActionEnum {
  WARN = 'WARN',
  PAUSE = 'PAUSE',
  BLOCK = 'BLOCK',
}

export enum ReminderChannelEnum {
  WHATSAPP = 'WHATSAPP',
  SMS = 'SMS',
  PUSH = 'PUSH',
}

export enum ReminderStatusEnum {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}

export enum ReminderResponseTypeEnum {
  NONE = 'NONE',
  FULL_PAYMENT = 'FULL_PAYMENT',
  PARTIAL_PAYMENT = 'PARTIAL_PAYMENT',
}

// ── Aggregate Props ───────────────────────────────────────────────────────────

export interface CustomerCreditSettingsProps {
  customerId: bigint;
  creditType: CreditTypeEnum;
  warningThresholdPercent: number;
  actionOnBreach: CreditBreachActionEnum;
  minimumBalanceWarning: number | null;
}

export interface CreateCreditSettingsProps {
  customerId: bigint;
  creditType?: CreditTypeEnum;
  warningThresholdPercent?: number;
  actionOnBreach?: CreditBreachActionEnum;
  minimumBalanceWarning?: number | null;
}

export interface SetCreditSettingsPatch {
  creditType?: CreditTypeEnum;
  warningThresholdPercent?: number;
  actionOnBreach?: CreditBreachActionEnum;
  minimumBalanceWarning?: number | null;
}

export interface ReminderConfigProps {
  vendorId: bigint;
  autoRemindersEnabled: boolean;
  schedule3Days: boolean;
  schedule15Days: boolean;
  schedule30Days: boolean;
  reminderTemplate: string | null;
  excludedCustomerIds: number[];
}

export interface UpdateReminderConfigPatch {
  autoRemindersEnabled?: boolean;
  schedule3Days?: boolean;
  schedule15Days?: boolean;
  schedule30Days?: boolean;
  reminderTemplate?: string | null;
  excludedCustomerIds?: number[];
}

export interface PaymentReminderProps {
  customerId: bigint;
  vendorId: bigint;
  amountDue: number;
  reminderDate: Date;
  sentVia: ReminderChannelEnum;
  status: ReminderStatusEnum;
  responseType: ReminderResponseTypeEnum | null;
  responseAmount: number | null;
}

// ── Breach Evaluation Result ──────────────────────────────────────────────────

export interface BreachEvaluationResult {
  breached: boolean;
  nearLimit: boolean;
  utilizationPercent: number;
}
