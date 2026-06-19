/**
 * Referral repository port — domain depends on this interface, not Prisma.
 */
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { VendorReferral } from '../domain/vendor-referral.entity';
import { VendorCreditEntity } from '../domain/vendor-credit.entity';
import {
  ReferralVendorStatus,
  CreditTransactionType,
  CreditSourceType,
  ReferralRewardKind,
  LeaderboardPeriodType,
} from '../domain/vendor-referral.types';

// ============================================================
// VendorReferral rows
// ============================================================

export interface VendorReferralRow {
  id: bigint;
  referrerVendorId: bigint;
  refereeVendorId: bigint | null;
  referralCode: string;
  status: ReferralVendorStatus;
  rewardType: string | null;
  rewardAmount: number | null;
  refereeName: string | null;
  refereePhone: string | null;
  signupDate: Date | null;
  firstCustomerDate: Date | null;
  milestone10At: Date | null;
  milestone50At: Date | null;
  revenueShareUntil: Date | null;
  clawedBackAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ============================================================
// Credit rows
// ============================================================

export interface VendorCreditRow {
  id: bigint;
  vendorId: bigint;
  availableCredits: number;
  lifetimeCreditsEarned: number;
  lifetimeCreditsUsed: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreditTransactionRow {
  id: bigint;
  vendorId: bigint;
  vendorCreditId: bigint;
  transactionType: CreditTransactionType;
  rewardKind: ReferralRewardKind | null;
  amount: number;
  balanceAfter: number;
  sourceType: CreditSourceType | null;
  sourceId: bigint | null;
  description: string | null;
  createdAt: Date;
}

// ============================================================
// Dashboard earned-breakdown aggregate
// ============================================================

/**
 * Per-referral earned breakdown, summed by reward kind, from EARNED
 * credit_transactions. All amounts default to 0 when a kind has no rows.
 */
export interface ReferralEarnedBreakdown {
  signup: number;
  milestone10: number;
  milestone50: number;
  revenueShare: number;
}

// ============================================================
// Leaderboard rows
// ============================================================

export interface LeaderboardRow {
  id: bigint;
  vendorId: bigint;
  periodType: LeaderboardPeriodType;
  periodStart: Date;
  rankPosition: number;
  totalReferrals: number;
  qualifiedReferrals: number;
  rewardEarned: number;
  computedAt: Date;
}

// ============================================================
// Customer referral rows
// ============================================================

export interface CustomerReferralRow {
  id: bigint;
  vendorId: bigint;
  referrerCustomerId: bigint;
  refereeCustomerId: bigint;
  status: string;
  rewardType: string | null;
  referrerRewardAmount: number | null;
  qualifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ============================================================
// Invite rows
// ============================================================

export interface CustomerInviteRow {
  id: bigint;
  vendorId: bigint;
  customerId: bigint | null;
  phone: string;
  status: string;
  messageLanguage: string | null;
  attemptCount: number;
  autoResend: boolean;
  maxAttempts: number;
  sentAt: Date | null;
  lastAttemptAt: Date | null;
  signedUpAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// ============================================================
// Repository Port Interface
// ============================================================

export interface IReferralRepository {
  // VendorReferral
  insertVendorReferral(entity: VendorReferral, tx?: PrismaTransaction): Promise<VendorReferralRow>;
  updateVendorReferral(entity: VendorReferral, tx?: PrismaTransaction): Promise<VendorReferralRow>;
  findVendorReferralById(id: bigint, tx?: PrismaTransaction): Promise<VendorReferralRow | null>;
  findVendorReferralByCode(
    code: string,
    status?: ReferralVendorStatus,
    tx?: PrismaTransaction
  ): Promise<VendorReferralRow | null>;
  findVendorReferralByPhone(
    referrerVendorId: bigint,
    phone: string,
    tx?: PrismaTransaction
  ): Promise<VendorReferralRow | null>;
  listVendorReferrals(
    referrerVendorId: bigint,
    page: number,
    limit: number,
    status?: ReferralVendorStatus
  ): Promise<{ rows: VendorReferralRow[]; total: number }>;
  countTodayReferrals(referrerVendorId: bigint): Promise<number>;
  findActiveReferralsByReferee(refereeVendorId: bigint): Promise<VendorReferralRow | null>;
  findReferralsForMilestoneSweep(): Promise<VendorReferralRow[]>;
  findReferralsForClawbackSweep(): Promise<VendorReferralRow[]>;
  findReferralsInRevenueShareWindow(yearMonth: string): Promise<VendorReferralRow[]>;

  // VendorCredit
  findOrCreateVendorCredit(vendorId: bigint, tx?: PrismaTransaction): Promise<VendorCreditEntity>;
  earnCredit(params: {
    vendorId: bigint;
    amount: number;
    rewardKind?: ReferralRewardKind;
    sourceType?: CreditSourceType;
    sourceId?: bigint;
    description?: string;
    tx: PrismaTransaction;
  }): Promise<CreditTransactionRow>;
  useCredit(params: {
    vendorId: bigint;
    amount: number;
    sourceType?: CreditSourceType;
    sourceId?: bigint;
    description?: string;
    tx: PrismaTransaction;
  }): Promise<CreditTransactionRow>;
  adjustCredit(params: {
    vendorId: bigint;
    amount: number;
    description?: string;
    tx: PrismaTransaction;
  }): Promise<CreditTransactionRow>;
  getVendorCreditBalance(vendorId: bigint, tx?: PrismaTransaction): Promise<VendorCreditRow | null>;
  listCreditTransactions(
    vendorId: bigint,
    page: number,
    limit: number,
    type?: CreditTransactionType
  ): Promise<{ rows: CreditTransactionRow[]; total: number }>;
  hasRevenueShareForMonth(
    vendorId: bigint,
    referralId: bigint,
    yearMonth: string
  ): Promise<boolean>;

  // Vendor referral_code management
  getVendorReferralCode(vendorId: bigint): Promise<string | null>;
  setVendorReferralCode(vendorId: bigint, code: string, tx?: PrismaTransaction): Promise<void>;
  isReferralCodeUnique(code: string, excludeVendorId?: bigint): Promise<boolean>;
  getVendorName(vendorId: bigint): Promise<string | null>;
  getVendorPhone(vendorId: bigint): Promise<string | null>;
  getVendorInfo(vendorId: bigint): Promise<{ name: string; category: string | null } | null>;
  countVendorCustomers(vendorId: bigint): Promise<number>;
  findVendorNamesByIds(vendorIds: bigint[]): Promise<Map<bigint, string>>;
  findCustomerNamesByIds(customerIds: bigint[]): Promise<Map<bigint, string | null>>;

  // Ledger queries filtered by referral source
  listCreditTransactionsByReferral(
    vendorId: bigint,
    referralId: bigint
  ): Promise<CreditTransactionRow[]>;
  totalEarnedForReferral(vendorId: bigint, referralId: bigint): Promise<number>;

  /**
   * Earned breakdown for ALL of a vendor's referrals in a SINGLE groupBy query.
   * Groups EARNED credit_transactions by (sourceId, rewardKind) scoped to vendorId.
   * Returns a Map keyed by referralId (sourceId) → per-kind sums. Referrals with
   * no earned transactions are simply absent from the map (caller defaults to 0).
   * Eliminates the dashboard N+1 over the ledger.
   */
  earnedBreakdownByReferral(vendorId: bigint): Promise<Map<bigint, ReferralEarnedBreakdown>>;

  // CustomerReferral
  insertCustomerReferral(
    input: {
      vendorId: bigint;
      referrerCustomerId: bigint;
      refereeCustomerId: bigint;
      referrerRewardAmount?: number;
    },
    tx?: PrismaTransaction
  ): Promise<CustomerReferralRow>;
  findCustomerReferralSummary(
    vendorId: bigint
  ): Promise<{ newThisMonth: number; totalFromReferrals: number; totalCustomers: number }>;
  findTopReferrers(
    vendorId: bigint,
    limit?: number
  ): Promise<Array<{ customerId: bigint; customerName: string | null; referralCount: number }>>;
  listRecentCustomerReferrals(
    vendorId: bigint,
    page: number,
    limit: number
  ): Promise<{ rows: CustomerReferralRow[]; total: number }>;

  // Customer lookup for invite targeting (keeps BulkInviteCommand infrastructure-free)
  findCustomersForInvite(
    vendorId: bigint,
    options: { customerIds?: bigint[]; excludeOnPaycycle: boolean; limit?: number }
  ): Promise<Array<{ id: bigint; phone: string; userId: bigint | null; name: string | null }>>;

  // Customer invites
  insertInvites(
    rows: Array<{
      vendorId: bigint;
      customerId: bigint | null;
      phone: string;
      messageLanguage?: string;
      autoResend: boolean;
      maxAttempts: number;
    }>,
    tx?: PrismaTransaction
  ): Promise<number>;
  findInvitesDueForResend(vendorId: bigint): Promise<CustomerInviteRow[]>;
  findActiveInviteByPhone(vendorId: bigint, phone: string): Promise<CustomerInviteRow | null>;
  updateInviteStatus(id: bigint, status: string, tx?: PrismaTransaction): Promise<void>;
  incrementInviteAttempt(id: bigint, tx?: PrismaTransaction): Promise<void>;

  // Leaderboard
  upsertLeaderboardEntry(row: Omit<LeaderboardRow, 'id'>, tx?: PrismaTransaction): Promise<void>;
  listLeaderboard(
    period: LeaderboardPeriodType,
    page: number,
    limit: number
  ): Promise<{ rows: LeaderboardRow[]; total: number }>;

  // Nearby vendors (locality string-match)
  findNearbyVendors(vendorId: bigint): Promise<
    Array<{
      vendorId: bigint;
      vendorName: string;
      category: string | null;
      locality: string | null;
      customerCount: number;
    }>
  >;

  // Transaction wrapper
  transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T>;
}
