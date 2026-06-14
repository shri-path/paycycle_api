/**
 * voice.types.ts — Domain-level enums and string-literal unions for the voice module.
 * No framework imports (pure TypeScript).
 */

export enum SupportedLanguageCode {
  EN = 'EN',
  HI = 'HI',
  TA = 'TA',
  TE = 'TE',
  MR = 'MR',
  BN = 'BN',
  KN = 'KN',
  ML = 'ML',
  GU = 'GU',
}

export enum BillLanguagePolicyValue {
  CUSTOMER = 'CUSTOMER',
  MY_LANGUAGE = 'MY_LANGUAGE',
  ENGLISH = 'ENGLISH',
}

export enum TemplateTypeValue {
  PAYMENT_REMINDER = 'PAYMENT_REMINDER',
  MONTHLY_BILL = 'MONTHLY_BILL',
  DELIVERY_CONFIRMATION = 'DELIVERY_CONFIRMATION',
  LEAVE_CONFIRMATION = 'LEAVE_CONFIRMATION',
}

export enum VoiceIntentAction {
  MARK_DELIVERED = 'MARK_DELIVERED',
  MARK_LEAVE = 'MARK_LEAVE',
  MARK_ALL = 'MARK_ALL',
  ADJUST_QUANTITY = 'ADJUST_QUANTITY',
  UNKNOWN = 'UNKNOWN',
}

export const SUPPORTED_LANGUAGE_CODES = Object.values(SupportedLanguageCode);

export interface RosterEntry {
  id: bigint;
  name: string;
}

export interface InterpretationResult {
  intent: {
    action: VoiceIntentAction;
    customerName?: string;
    quantity?: number;
  };
  customerId?: bigint;
  candidates?: bigint[];
  matchConfidence: number;
}
