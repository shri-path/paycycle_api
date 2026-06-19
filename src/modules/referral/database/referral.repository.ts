/**
 * Prisma adapter for IReferralRepository.
 */
import { Prisma, ReferralInviteStatus } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import { VendorReferral } from '../domain/vendor-referral.entity';
import { VendorCreditEntity } from '../domain/vendor-credit.entity';
import {
  ReferralVendorStatus,
  CreditTransactionType,
  CreditSourceType,
  ReferralRewardKind,
  LeaderboardPeriodType,
  REWARD_AMOUNTS,
} from '../domain/vendor-referral.types';
import {
  IReferralRepository,
  VendorReferralRow,
  VendorCreditRow,
  CreditTransactionRow,
  CustomerReferralRow,
  CustomerInviteRow,
  LeaderboardRow,
  ReferralEarnedBreakdown,
} from './referral.repository.port';

function toVendorReferralRow(r: {
  id: bigint;
  referrerVendorId: bigint;
  refereeVendorId: bigint | null;
  referralCode: string;
  status: string;
  rewardType: string | null;
  rewardAmount: Prisma.Decimal | null;
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
}): VendorReferralRow {
  return {
    id: r.id,
    referrerVendorId: r.referrerVendorId,
    refereeVendorId: r.refereeVendorId,
    referralCode: r.referralCode,
    status: r.status as ReferralVendorStatus,
    rewardType: r.rewardType,
    rewardAmount: r.rewardAmount ? Number(r.rewardAmount) : null,
    refereeName: r.refereeName,
    refereePhone: r.refereePhone,
    signupDate: r.signupDate,
    firstCustomerDate: r.firstCustomerDate,
    milestone10At: r.milestone10At,
    milestone50At: r.milestone50At,
    revenueShareUntil: r.revenueShareUntil,
    clawedBackAt: r.clawedBackAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
  };
}

export class ReferralRepository implements IReferralRepository {
  // ============================================================
  // VendorReferral
  // ============================================================

  async insertVendorReferral(
    entity: VendorReferral,
    tx?: PrismaTransaction
  ): Promise<VendorReferralRow> {
    const db = tx ?? prisma;
    try {
      const r = await db.vendorReferral.create({
        data: {
          referrerVendorId: entity.referrerVendorId,
          refereeVendorId: entity.refereeVendorId ?? null,
          referralCode: entity.referralCode,
          status: entity.status,
          rewardType: entity.rewardType ?? null,
          rewardAmount: entity.rewardAmount ?? null,
          refereeName: entity.refereeName ?? null,
          refereePhone: entity.refereePhone ?? null,
          signupDate: entity.signupDate ?? null,
          milestone10At: entity.milestone10At ?? null,
          milestone50At: entity.milestone50At ?? null,
          revenueShareUntil: entity.revenueShareUntil ?? null,
          clawedBackAt: entity.clawedBackAt ?? null,
        },
      });
      return toVendorReferralRow(r);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictError('A referral to this phone already exists');
      }
      throw e;
    }
  }

  async updateVendorReferral(
    entity: VendorReferral,
    tx?: PrismaTransaction
  ): Promise<VendorReferralRow> {
    const db = tx ?? prisma;
    const r = await db.vendorReferral.update({
      where: { id: entity.id },
      data: {
        refereeVendorId: entity.refereeVendorId ?? null,
        status: entity.status,
        signupDate: entity.signupDate ?? null,
        firstCustomerDate: entity.firstCustomerDate ?? null,
        milestone10At: entity.milestone10At ?? null,
        milestone50At: entity.milestone50At ?? null,
        revenueShareUntil: entity.revenueShareUntil ?? null,
        clawedBackAt: entity.clawedBackAt ?? null,
        updatedAt: new Date(),
      },
    });
    return toVendorReferralRow(r);
  }

  async findVendorReferralById(
    id: bigint,
    tx?: PrismaTransaction
  ): Promise<VendorReferralRow | null> {
    const db = tx ?? prisma;
    const r = await db.vendorReferral.findFirst({ where: { id, deletedAt: null } });
    return r ? toVendorReferralRow(r) : null;
  }

  async findVendorReferralByCode(
    code: string,
    status?: ReferralVendorStatus,
    tx?: PrismaTransaction
  ): Promise<VendorReferralRow | null> {
    const db = tx ?? prisma;
    const r = await db.vendorReferral.findFirst({
      where: { referralCode: code, ...(status ? { status } : {}), deletedAt: null },
    });
    return r ? toVendorReferralRow(r) : null;
  }

  async findVendorReferralByPhone(
    referrerVendorId: bigint,
    phone: string,
    tx?: PrismaTransaction
  ): Promise<VendorReferralRow | null> {
    const db = tx ?? prisma;
    const r = await db.vendorReferral.findFirst({
      where: {
        referrerVendorId,
        refereePhone: phone,
        status: { not: ReferralVendorStatus.SIGNED_UP },
        deletedAt: null,
      },
    });
    return r ? toVendorReferralRow(r) : null;
  }

  async listVendorReferrals(
    referrerVendorId: bigint,
    page: number,
    limit: number,
    status?: ReferralVendorStatus
  ): Promise<{ rows: VendorReferralRow[]; total: number }> {
    const where = { referrerVendorId, ...(status ? { status } : {}), deletedAt: null };
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      prisma.vendorReferral.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      prisma.vendorReferral.count({ where }),
    ]);
    return { rows: rows.map(toVendorReferralRow), total };
  }

  async countTodayReferrals(referrerVendorId: bigint): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return prisma.vendorReferral.count({
      where: { referrerVendorId, createdAt: { gte: today }, deletedAt: null },
    });
  }

  async findActiveReferralsByReferee(refereeVendorId: bigint): Promise<VendorReferralRow | null> {
    const r = await prisma.vendorReferral.findFirst({
      where: { refereeVendorId, deletedAt: null },
    });
    return r ? toVendorReferralRow(r) : null;
  }

  async findReferralsForMilestoneSweep(): Promise<VendorReferralRow[]> {
    const rows = await prisma.vendorReferral.findMany({
      where: {
        status: {
          in: [
            ReferralVendorStatus.SIGNED_UP,
            ReferralVendorStatus.QUALIFIED,
            ReferralVendorStatus.REWARDED,
          ],
        },
        refereeVendorId: { not: null },
        deletedAt: null,
      },
    });
    return rows.map(toVendorReferralRow);
  }

  async findReferralsForClawbackSweep(): Promise<VendorReferralRow[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - REWARD_AMOUNTS.CLAWBACK_DAYS);
    const rows = await prisma.vendorReferral.findMany({
      where: {
        status: {
          in: [
            ReferralVendorStatus.SIGNED_UP,
            ReferralVendorStatus.QUALIFIED,
            ReferralVendorStatus.REWARDED,
          ],
        },
        signupDate: { gte: cutoff },
        clawedBackAt: null,
        refereeVendorId: { not: null },
        deletedAt: null,
      },
    });
    return rows.map(toVendorReferralRow);
  }

  async findReferralsInRevenueShareWindow(yearMonth: string): Promise<VendorReferralRow[]> {
    const [year, month] = yearMonth.split('-').map(Number);
    if (!year || !month) return [];
    const monthStart = new Date(year, month - 1, 1);
    const rows = await prisma.vendorReferral.findMany({
      where: {
        status: { in: [ReferralVendorStatus.QUALIFIED, ReferralVendorStatus.REWARDED] },
        revenueShareUntil: { gte: monthStart },
        clawedBackAt: null,
        refereeVendorId: { not: null },
        deletedAt: null,
      },
    });
    return rows.map(toVendorReferralRow);
  }

  // ============================================================
  // VendorCredit (atomic balance mutations)
  // ============================================================

  async findOrCreateVendorCredit(
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<VendorCreditEntity> {
    const db = tx ?? prisma;
    const existing = await db.vendorCredit.findUnique({ where: { vendorId } });
    if (existing) {
      return VendorCreditEntity.fromPersistence({
        id: existing.id,
        props: {
          vendorId: existing.vendorId,
          availableCredits: Number(existing.availableCredits),
          lifetimeCreditsEarned: Number(existing.lifetimeCreditsEarned),
          lifetimeCreditsUsed: Number(existing.lifetimeCreditsUsed),
        },
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      });
    }
    const created = await db.vendorCredit.create({
      data: { vendorId, availableCredits: 0, lifetimeCreditsEarned: 0, lifetimeCreditsUsed: 0 },
    });
    return VendorCreditEntity.fromPersistence({
      id: created.id,
      props: {
        vendorId: created.vendorId,
        availableCredits: 0,
        lifetimeCreditsEarned: 0,
        lifetimeCreditsUsed: 0,
      },
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
  }

  async earnCredit(params: {
    vendorId: bigint;
    amount: number;
    rewardKind?: ReferralRewardKind;
    sourceType?: CreditSourceType;
    sourceId?: bigint;
    description?: string;
    tx: PrismaTransaction;
  }): Promise<CreditTransactionRow> {
    const { vendorId, amount, rewardKind, sourceType, sourceId, description, tx } = params;

    // Atomic increment
    const credit = await tx.vendorCredit.upsert({
      where: { vendorId },
      update: {
        availableCredits: { increment: amount },
        lifetimeCreditsEarned: { increment: amount },
      },
      create: {
        vendorId,
        availableCredits: amount,
        lifetimeCreditsEarned: amount,
        lifetimeCreditsUsed: 0,
      },
    });

    const txn = await tx.creditTransaction.create({
      data: {
        vendorId,
        vendorCreditId: credit.id,
        transactionType: CreditTransactionType.EARNED,
        rewardKind: rewardKind ?? null,
        amount,
        balanceAfter: Number(credit.availableCredits),
        sourceType: sourceType ?? null,
        sourceId: sourceId ?? null,
        description: description ?? null,
      },
    });

    return this.toCreditTransactionRow(txn);
  }

  async useCredit(params: {
    vendorId: bigint;
    amount: number;
    sourceType?: CreditSourceType;
    sourceId?: bigint;
    description?: string;
    tx: PrismaTransaction;
  }): Promise<CreditTransactionRow> {
    const { vendorId, amount, sourceType, sourceId, description, tx } = params;

    const credit = await tx.vendorCredit.update({
      where: { vendorId },
      data: {
        availableCredits: { decrement: amount },
        lifetimeCreditsUsed: { increment: amount },
      },
    });

    const txn = await tx.creditTransaction.create({
      data: {
        vendorId,
        vendorCreditId: credit.id,
        transactionType: CreditTransactionType.USED,
        rewardKind: null,
        amount,
        balanceAfter: Number(credit.availableCredits),
        sourceType: sourceType ?? null,
        sourceId: sourceId ?? null,
        description: description ?? null,
      },
    });

    return this.toCreditTransactionRow(txn);
  }

  async adjustCredit(params: {
    vendorId: bigint;
    amount: number;
    description?: string;
    tx: PrismaTransaction;
  }): Promise<CreditTransactionRow> {
    const { vendorId, amount, description, tx } = params;

    // Get current balance to clamp
    const current = await tx.vendorCredit.findUnique({ where: { vendorId } });
    const currentBalance = current ? Number(current.availableCredits) : 0;
    const actualAmount = Math.min(amount, currentBalance);

    const credit = await tx.vendorCredit.upsert({
      where: { vendorId },
      update: {
        availableCredits: { decrement: actualAmount },
        lifetimeCreditsUsed: { increment: actualAmount },
      },
      create: { vendorId, availableCredits: 0, lifetimeCreditsEarned: 0, lifetimeCreditsUsed: 0 },
    });

    const txn = await tx.creditTransaction.create({
      data: {
        vendorId,
        vendorCreditId: credit.id,
        transactionType: CreditTransactionType.ADJUSTMENT,
        rewardKind: null,
        amount: actualAmount > 0 ? actualAmount : amount,
        balanceAfter: Number(credit.availableCredits),
        sourceType: CreditSourceType.VENDOR_REFERRAL,
        sourceId: null,
        description: description ?? 'Clawback adjustment',
      },
    });

    return this.toCreditTransactionRow(txn);
  }

  async getVendorCreditBalance(
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<VendorCreditRow | null> {
    const db = tx ?? prisma;
    const r = await db.vendorCredit.findUnique({ where: { vendorId } });
    if (!r) return null;
    return {
      id: r.id,
      vendorId: r.vendorId,
      availableCredits: Number(r.availableCredits),
      lifetimeCreditsEarned: Number(r.lifetimeCreditsEarned),
      lifetimeCreditsUsed: Number(r.lifetimeCreditsUsed),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  async listCreditTransactions(
    vendorId: bigint,
    page: number,
    limit: number,
    type?: CreditTransactionType
  ): Promise<{ rows: CreditTransactionRow[]; total: number }> {
    const where = { vendorId, ...(type ? { transactionType: type } : {}) };
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.creditTransaction.count({ where }),
    ]);
    return { rows: rows.map((r) => this.toCreditTransactionRow(r)), total };
  }

  async hasRevenueShareForMonth(
    vendorId: bigint,
    referralId: bigint,
    yearMonth: string
  ): Promise<boolean> {
    const count = await prisma.creditTransaction.count({
      where: {
        vendorId,
        rewardKind: ReferralRewardKind.REVENUE_SHARE,
        sourceId: referralId,
        description: { contains: `REVENUE_SHARE:${yearMonth}` },
      },
    });
    return count > 0;
  }

  private toCreditTransactionRow(r: {
    id: bigint;
    vendorId: bigint;
    vendorCreditId: bigint;
    transactionType: string;
    rewardKind: string | null;
    amount: Prisma.Decimal;
    balanceAfter: Prisma.Decimal;
    sourceType: string | null;
    sourceId: bigint | null;
    description: string | null;
    createdAt: Date;
  }): CreditTransactionRow {
    return {
      id: r.id,
      vendorId: r.vendorId,
      vendorCreditId: r.vendorCreditId,
      transactionType: r.transactionType as CreditTransactionType,
      rewardKind: (r.rewardKind as ReferralRewardKind) ?? null,
      amount: Number(r.amount),
      balanceAfter: Number(r.balanceAfter),
      sourceType: (r.sourceType as CreditSourceType) ?? null,
      sourceId: r.sourceId,
      description: r.description,
      createdAt: r.createdAt,
    };
  }

  // ============================================================
  // Vendor referral code management
  // ============================================================

  async getVendorReferralCode(vendorId: bigint): Promise<string | null> {
    const v = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { referralCode: true },
    });
    return v?.referralCode ?? null;
  }

  async setVendorReferralCode(
    vendorId: bigint,
    code: string,
    tx?: PrismaTransaction
  ): Promise<void> {
    const db = tx ?? prisma;
    await db.vendor.update({ where: { id: vendorId }, data: { referralCode: code } });
  }

  async isReferralCodeUnique(code: string, excludeVendorId?: bigint): Promise<boolean> {
    const existing = await prisma.vendor.findFirst({
      where: { referralCode: code, ...(excludeVendorId ? { id: { not: excludeVendorId } } : {}) },
    });
    return !existing;
  }

  async getVendorName(vendorId: bigint): Promise<string | null> {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true } });
    return v?.name ?? null;
  }

  async getVendorPhone(vendorId: bigint): Promise<string | null> {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { phone: true } });
    return v?.phone ?? null;
  }

  async getVendorInfo(vendorId: bigint): Promise<{ name: string; category: string | null } | null> {
    const v = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { name: true, category: true },
    });
    if (!v) return null;
    return { name: v.name, category: v.category };
  }

  async countVendorCustomers(vendorId: bigint): Promise<number> {
    return prisma.vendorCustomer.count({ where: { vendorId, deletedAt: null } });
  }

  async findVendorNamesByIds(vendorIds: bigint[]): Promise<Map<bigint, string>> {
    if (vendorIds.length === 0) return new Map();
    const vendors = await prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, name: true },
    });
    return new Map(vendors.map((v) => [v.id, v.name]));
  }

  async findCustomerNamesByIds(customerIds: bigint[]): Promise<Map<bigint, string | null>> {
    if (customerIds.length === 0) return new Map();
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true },
    });
    return new Map(customers.map((c) => [c.id, c.name]));
  }

  async listCreditTransactionsByReferral(
    vendorId: bigint,
    referralId: bigint
  ): Promise<CreditTransactionRow[]> {
    const rows = await prisma.creditTransaction.findMany({
      where: { vendorId, sourceId: referralId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toCreditTransactionRow(r));
  }

  async totalEarnedForReferral(vendorId: bigint, referralId: bigint): Promise<number> {
    const result = await prisma.creditTransaction.aggregate({
      where: {
        vendorId,
        sourceId: referralId,
        transactionType: CreditTransactionType.EARNED,
      },
      _sum: { amount: true },
    });
    return Number(result._sum.amount ?? 0);
  }

  async earnedBreakdownByReferral(vendorId: bigint): Promise<Map<bigint, ReferralEarnedBreakdown>> {
    // Single groupBy over EARNED rows for this vendor, grouped by referral
    // (sourceId) and rewardKind. Replaces the per-referral ledger N+1.
    const groups = await prisma.creditTransaction.groupBy({
      by: ['sourceId', 'rewardKind'],
      where: {
        vendorId,
        transactionType: CreditTransactionType.EARNED,
        sourceType: CreditSourceType.VENDOR_REFERRAL,
        sourceId: { not: null },
      },
      _sum: { amount: true },
    });

    const map = new Map<bigint, ReferralEarnedBreakdown>();
    for (const g of groups) {
      if (g.sourceId === null) continue;
      const amount = Number(g._sum.amount ?? 0);
      const entry =
        map.get(g.sourceId) ??
        ({ signup: 0, milestone10: 0, milestone50: 0, revenueShare: 0 } as ReferralEarnedBreakdown);

      switch (g.rewardKind) {
        case ReferralRewardKind.SIGNUP_BONUS:
          entry.signup += amount;
          break;
        case ReferralRewardKind.MILESTONE_10:
          entry.milestone10 += amount;
          break;
        case ReferralRewardKind.MILESTONE_50:
          entry.milestone50 += amount;
          break;
        case ReferralRewardKind.REVENUE_SHARE:
          entry.revenueShare += amount;
          break;
        default:
          // Unknown/unmapped reward kinds do not contribute to the breakdown.
          break;
      }
      map.set(g.sourceId, entry);
    }
    return map;
  }

  // ============================================================
  // CustomerReferral
  // ============================================================

  async insertCustomerReferral(
    input: {
      vendorId: bigint;
      referrerCustomerId: bigint;
      refereeCustomerId: bigint;
      referrerRewardAmount?: number;
    },
    tx?: PrismaTransaction
  ): Promise<CustomerReferralRow> {
    const db = tx ?? prisma;
    const r = await db.customerReferral.create({
      data: {
        vendorId: input.vendorId,
        referrerCustomerId: input.referrerCustomerId,
        refereeCustomerId: input.refereeCustomerId,
        status: 'SENT',
        rewardType: 'BILL_DISCOUNT',
        referrerRewardAmount: input.referrerRewardAmount ?? REWARD_AMOUNTS.CUSTOMER_REFERRAL,
      },
    });
    return this.toCustomerReferralRow(r);
  }

  async findCustomerReferralSummary(
    vendorId: bigint
  ): Promise<{ newThisMonth: number; totalFromReferrals: number; totalCustomers: number }> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [newThisMonth, total, totalCustomers] = await Promise.all([
      prisma.customerReferral.count({
        where: { vendorId, createdAt: { gte: monthStart }, deletedAt: null },
      }),
      prisma.customerReferral.count({ where: { vendorId, deletedAt: null } }),
      prisma.vendorCustomer.count({ where: { vendorId, deletedAt: null } }),
    ]);

    return { newThisMonth, totalFromReferrals: total, totalCustomers };
  }

  async findTopReferrers(
    vendorId: bigint,
    limit = 5
  ): Promise<Array<{ customerId: bigint; customerName: string | null; referralCount: number }>> {
    const results = await prisma.customerReferral.groupBy({
      by: ['referrerCustomerId'],
      where: { vendorId, deletedAt: null },
      _count: { referrerCustomerId: true },
      orderBy: { _count: { referrerCustomerId: 'desc' } },
      take: limit,
    });

    const customerIds = results.map((r) => r.referrerCustomerId);
    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true },
    });
    const customerMap = new Map(customers.map((c) => [c.id, c.name]));

    return results.map((r) => ({
      customerId: r.referrerCustomerId,
      customerName: customerMap.get(r.referrerCustomerId) ?? null,
      referralCount: r._count.referrerCustomerId,
    }));
  }

  async listRecentCustomerReferrals(
    vendorId: bigint,
    page: number,
    limit: number
  ): Promise<{ rows: CustomerReferralRow[]; total: number }> {
    const skip = (page - 1) * limit;
    const where = { vendorId, deletedAt: null };
    const [rows, total] = await Promise.all([
      prisma.customerReferral.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.customerReferral.count({ where }),
    ]);
    return { rows: rows.map((r) => this.toCustomerReferralRow(r)), total };
  }

  private toCustomerReferralRow(r: {
    id: bigint;
    vendorId: bigint;
    referrerCustomerId: bigint;
    refereeCustomerId: bigint;
    status: string;
    rewardType: string | null;
    referrerRewardAmount: Prisma.Decimal | null;
    qualifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): CustomerReferralRow {
    return {
      id: r.id,
      vendorId: r.vendorId,
      referrerCustomerId: r.referrerCustomerId,
      refereeCustomerId: r.refereeCustomerId,
      status: r.status,
      rewardType: r.rewardType,
      referrerRewardAmount: r.referrerRewardAmount ? Number(r.referrerRewardAmount) : null,
      qualifiedAt: r.qualifiedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    };
  }

  // ============================================================
  // Customer invites
  // ============================================================

  async findCustomersForInvite(
    vendorId: bigint,
    options: { customerIds?: bigint[]; excludeOnPaycycle: boolean; limit?: number }
  ): Promise<Array<{ id: bigint; phone: string; userId: bigint | null; name: string | null }>> {
    const rows = await prisma.vendorCustomer.findMany({
      where: {
        vendorId,
        deletedAt: null,
        ...(options.customerIds ? { customerId: { in: options.customerIds } } : {}),
        ...(options.excludeOnPaycycle ? { customer: { userId: null } } : {}),
      },
      include: { customer: { select: { id: true, phone: true, userId: true, name: true } } },
      ...(options.limit ? { take: options.limit } : {}),
    });
    return rows.map((r) => r.customer);
  }

  async insertInvites(
    rows: Array<{
      vendorId: bigint;
      customerId: bigint | null;
      phone: string;
      messageLanguage?: string;
      autoResend: boolean;
      maxAttempts: number;
    }>,
    tx?: PrismaTransaction
  ): Promise<number> {
    const db = tx ?? prisma;
    const now = new Date();
    const result = await db.referralCustomerInvite.createMany({
      data: rows.map((r) => ({
        vendorId: r.vendorId,
        customerId: r.customerId,
        phone: r.phone,
        status: 'SENT',
        messageLanguage: r.messageLanguage ?? null,
        autoResend: r.autoResend,
        maxAttempts: r.maxAttempts,
        attemptCount: 1,
        sentAt: now,
        lastAttemptAt: now,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async findActiveInviteByPhone(
    vendorId: bigint,
    phone: string
  ): Promise<CustomerInviteRow | null> {
    const r = await prisma.referralCustomerInvite.findFirst({
      where: { vendorId, phone, status: { in: ['SENT', 'DELIVERED'] }, deletedAt: null },
    });
    return r ? this.toInviteRow(r) : null;
  }

  async findInvitesDueForResend(vendorId: bigint): Promise<CustomerInviteRow[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const rows = await prisma.referralCustomerInvite.findMany({
      where: {
        vendorId,
        autoResend: true,
        status: { in: ['SENT', 'DELIVERED'] },
        lastAttemptAt: { lte: sevenDaysAgo },
        deletedAt: null,
      },
    });
    return rows.map((r) => this.toInviteRow(r));
  }

  async updateInviteStatus(id: bigint, status: string, tx?: PrismaTransaction): Promise<void> {
    const db = tx ?? prisma;
    await db.referralCustomerInvite.update({
      where: { id },
      data: { status: status as ReferralInviteStatus },
    });
  }

  async incrementInviteAttempt(id: bigint, tx?: PrismaTransaction): Promise<void> {
    const db = tx ?? prisma;
    await db.referralCustomerInvite.update({
      where: { id },
      data: { attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    });
  }

  private toInviteRow(r: {
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
  }): CustomerInviteRow {
    return {
      id: r.id,
      vendorId: r.vendorId,
      customerId: r.customerId,
      phone: r.phone,
      status: r.status,
      messageLanguage: r.messageLanguage,
      attemptCount: r.attemptCount,
      autoResend: r.autoResend,
      maxAttempts: r.maxAttempts,
      sentAt: r.sentAt,
      lastAttemptAt: r.lastAttemptAt,
      signedUpAt: r.signedUpAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
    };
  }

  // ============================================================
  // Leaderboard
  // ============================================================

  async upsertLeaderboardEntry(
    row: Omit<LeaderboardRow, 'id'>,
    tx?: PrismaTransaction
  ): Promise<void> {
    const db = tx ?? prisma;
    await db.referralLeaderboard.upsert({
      where: {
        vendorId_periodType_periodStart: {
          vendorId: row.vendorId,
          periodType: row.periodType,
          periodStart: row.periodStart,
        },
      },
      update: {
        rankPosition: row.rankPosition,
        totalReferrals: row.totalReferrals,
        qualifiedReferrals: row.qualifiedReferrals,
        rewardEarned: row.rewardEarned,
        computedAt: row.computedAt,
      },
      create: {
        vendorId: row.vendorId,
        periodType: row.periodType,
        periodStart: row.periodStart,
        rankPosition: row.rankPosition,
        totalReferrals: row.totalReferrals,
        qualifiedReferrals: row.qualifiedReferrals,
        rewardEarned: row.rewardEarned,
        computedAt: row.computedAt,
      },
    });
  }

  async listLeaderboard(
    period: LeaderboardPeriodType,
    page: number,
    limit: number
  ): Promise<{ rows: LeaderboardRow[]; total: number }> {
    // Get the most recent period start for this period type
    const latestPeriod = await prisma.referralLeaderboard.findFirst({
      where: { periodType: period },
      orderBy: { periodStart: 'desc' },
      select: { periodStart: true },
    });

    if (!latestPeriod) return { rows: [], total: 0 };

    const skip = (page - 1) * limit;
    const where = { periodType: period, periodStart: latestPeriod.periodStart };
    const [rows, total] = await Promise.all([
      prisma.referralLeaderboard.findMany({
        where,
        orderBy: { rankPosition: 'asc' },
        skip,
        take: limit,
      }),
      prisma.referralLeaderboard.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        vendorId: r.vendorId,
        periodType: r.periodType as LeaderboardPeriodType,
        periodStart: r.periodStart,
        rankPosition: r.rankPosition,
        totalReferrals: r.totalReferrals,
        qualifiedReferrals: r.qualifiedReferrals,
        rewardEarned: Number(r.rewardEarned),
        computedAt: r.computedAt,
      })),
      total,
    };
  }

  // ============================================================
  // Nearby vendors (locality string match — no PostGIS)
  // ============================================================

  async findNearbyVendors(vendorId: bigint): Promise<
    Array<{
      vendorId: bigint;
      vendorName: string;
      category: string | null;
      locality: string | null;
      customerCount: number;
    }>
  > {
    // Find the locality of the calling vendor's customers (majority locality)
    const callerCustomers = await prisma.vendorCustomer.findMany({
      where: { vendorId, deletedAt: null },
      include: { customer: { select: { locality: true } } },
      take: 50,
    });

    const localityCounts = new Map<string, number>();
    for (const vc of callerCustomers) {
      const loc = vc.customer.locality;
      if (loc) localityCounts.set(loc, (localityCounts.get(loc) ?? 0) + 1);
    }

    if (localityCounts.size === 0) return [];

    // Use the top locality for string-match
    let topLocality = '';
    let topCount = 0;
    for (const [loc, count] of localityCounts) {
      if (count > topCount) {
        topLocality = loc;
        topCount = count;
      }
    }

    // Find vendors that have customers in the same locality (excluding self)
    const nearbyVendorCustomers = await prisma.vendorCustomer.findMany({
      where: {
        vendorId: { not: vendorId },
        deletedAt: null,
        customer: { locality: topLocality },
      },
      include: { vendor: { select: { name: true, category: true } } },
    });

    const vendorMap = new Map<
      bigint,
      {
        vendorName: string;
        category: string | null;
        locality: string | null;
        customerCount: number;
      }
    >();
    for (const vc of nearbyVendorCustomers) {
      const existing = vendorMap.get(vc.vendorId);
      if (existing) {
        existing.customerCount++;
      } else {
        vendorMap.set(vc.vendorId, {
          vendorName: vc.vendor.name,
          category: vc.vendor.category,
          locality: topLocality,
          customerCount: 1,
        });
      }
    }

    return Array.from(vendorMap.entries()).map(([vid, v]) => ({
      vendorId: vid,
      ...v,
    }));
  }

  // ============================================================
  // Transaction wrapper
  // ============================================================

  async transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }
}
