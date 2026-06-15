/**
 * Domain types for the Referral module.
 * No framework imports — domain layer is framework-free.
 */

export enum ReferralVendorStatus {
  PENDING = 'PENDING',
  SIGNED_UP = 'SIGNED_UP',
  QUALIFIED = 'QUALIFIED',
  REWARDED = 'REWARDED',
}

export enum CustomerReferralStatus {
  SENT = 'SENT',
  SIGNED_UP = 'SIGNED_UP',
  QUALIFIED = 'QUALIFIED',
  REWARDED = 'REWARDED',
}

export enum VendorRewardType {
  SUBSCRIPTION_DISCOUNT = 'SUBSCRIPTION_DISCOUNT',
  CASH_CREDIT = 'CASH_CREDIT',
  FREE_MONTHS = 'FREE_MONTHS',
}

export enum CustomerRewardType {
  BILL_DISCOUNT = 'BILL_DISCOUNT',
  FREE_DAYS = 'FREE_DAYS',
  CASH_CREDIT = 'CASH_CREDIT',
}

export enum CreditTransactionType {
  EARNED = 'EARNED',
  USED = 'USED',
  EXPIRED = 'EXPIRED',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum CreditSourceType {
  VENDOR_REFERRAL = 'VENDOR_REFERRAL',
  CUSTOMER_REFERRAL = 'CUSTOMER_REFERRAL',
  SUBSCRIPTION_PAYMENT = 'SUBSCRIPTION_PAYMENT',
  MANUAL = 'MANUAL',
}

export enum ReferralRewardKind {
  SIGNUP_BONUS = 'SIGNUP_BONUS',
  MILESTONE_10 = 'MILESTONE_10',
  MILESTONE_50 = 'MILESTONE_50',
  REVENUE_SHARE = 'REVENUE_SHARE',
  CUSTOMER_REFERRAL = 'CUSTOMER_REFERRAL',
}

export enum ReferralInviteStatus {
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  SIGNED_UP = 'SIGNED_UP',
  FAILED = 'FAILED',
}

export enum LeaderboardPeriodType {
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  ALL_TIME = 'ALL_TIME',
}

// Reward amounts (business constants)
export const REWARD_AMOUNTS = {
  SIGNUP_BONUS: 500,
  MILESTONE_10: 1000,
  MILESTONE_50: 5000,
  REVENUE_SHARE_PERCENT: 0.1,
  CUSTOMER_REFERRAL: 50,
  WITHDRAWAL_MINIMUM: 2000,
  WITHDRAWAL_FEE_PERCENT: 0.1,
  REVENUE_SHARE_MONTHS: 6,
  QUALIFICATION_CUSTOMER_COUNT: 3,
  QUALIFICATION_DAYS: 30,
  CLAWBACK_DAYS: 60,
  REFERRAL_DAILY_LIMIT: 10,
} as const;

// ============================================================
// VendorReferral domain props
// ============================================================

export interface VendorReferralProps {
  referrerVendorId: bigint;
  refereeVendorId: bigint | null;
  referralCode: string;
  status: ReferralVendorStatus;
  rewardType: VendorRewardType | null;
  rewardAmount: number | null;
  refereeName: string | null;
  refereePhone: string | null;
  signupDate: Date | null;
  firstCustomerDate: Date | null;
  milestone10At: Date | null;
  milestone50At: Date | null;
  revenueShareUntil: Date | null;
  clawedBackAt: Date | null;
}

export interface CreateVendorReferralProps {
  referrerVendorId: bigint;
  referralCode: string;
  refereeName: string | null;
  refereePhone: string | null;
  rewardType?: VendorRewardType;
  rewardAmount?: number;
}

// ============================================================
// VendorCredit domain props
// ============================================================

export interface VendorCreditProps {
  vendorId: bigint;
  availableCredits: number;
  lifetimeCreditsEarned: number;
  lifetimeCreditsUsed: number;
}

export interface EarnCreditProps {
  amount: number;
  transactionType: CreditTransactionType;
  rewardKind?: ReferralRewardKind;
  sourceType?: CreditSourceType;
  sourceId?: bigint;
  description?: string;
}

// ============================================================
// CustomerReferral domain props
// ============================================================

export interface CustomerReferralProps {
  vendorId: bigint;
  referrerCustomerId: bigint;
  refereeCustomerId: bigint;
  status: CustomerReferralStatus;
  rewardType: CustomerRewardType | null;
  referrerRewardAmount: number | null;
  qualifiedAt: Date | null;
}
