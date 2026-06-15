/**
 * Referral cron jobs — gated behind ENABLE_CRON=true.
 * Timezone: Asia/Kolkata
 */
import cron from 'node-cron';
import { logger } from '@/infrastructure/logger/logger';
import { ReferralRepository } from './database/referral.repository';
import { CustomerCountAdapter } from './database/customer-count.adapter';
import { SubscriptionInvoiceAdapter } from './database/subscription-invoice.adapter';
import {
  ReferralVendorStatus,
  ReferralRewardKind,
  CreditSourceType,
  VendorRewardType,
  LeaderboardPeriodType,
  REWARD_AMOUNTS,
} from './domain/vendor-referral.types';
import { VendorReferral } from './domain/vendor-referral.entity';
import { VendorReferralRow } from './database/referral.repository.port';

const repository = new ReferralRepository();
const customerCountAdapter = new CustomerCountAdapter();
const subscriptionInvoiceAdapter = new SubscriptionInvoiceAdapter();

// ============================================================
// Helpers
// ============================================================

function rowToEntity(row: VendorReferralRow): VendorReferral {
  return VendorReferral.fromPersistence({
    id: row.id,
    props: {
      referrerVendorId: row.referrerVendorId,
      refereeVendorId: row.refereeVendorId,
      referralCode: row.referralCode,
      status: row.status,
      rewardType: row.rewardType as VendorRewardType | null,
      rewardAmount: row.rewardAmount,
      refereeName: row.refereeName,
      refereePhone: row.refereePhone,
      signupDate: row.signupDate,
      firstCustomerDate: row.firstCustomerDate,
      milestone10At: row.milestone10At,
      milestone50At: row.milestone50At,
      revenueShareUntil: row.revenueShareUntil,
      clawedBackAt: row.clawedBackAt,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

// ============================================================
// MilestoneSweep — daily 02:00 IST
// ============================================================

async function runMilestoneSweep(): Promise<void> {
  const log = logger.child({ cron: 'MilestoneSweep' });
  log.info('MilestoneSweep: starting');
  try {
    const referrals = await repository.findReferralsForMilestoneSweep();
    let qualified = 0;
    let milestone10 = 0;
    let milestone50 = 0;

    for (const row of referrals) {
      if (!row.refereeVendorId) continue;
      const refereeId = row.refereeVendorId;

      const customerCount = await customerCountAdapter.activeCustomerCount(refereeId);
      const withinWindow = await customerCountAdapter.customersAddedWithinDays(
        refereeId,
        REWARD_AMOUNTS.QUALIFICATION_DAYS
      );

      // Qualify if not yet qualified and >=3 customers within 30d
      if (
        row.status === ReferralVendorStatus.SIGNED_UP &&
        withinWindow >= REWARD_AMOUNTS.QUALIFICATION_CUSTOMER_COUNT
      ) {
        try {
          const referral = rowToEntity(row);
          referral.qualify();
          await repository.transaction(async (tx) => {
            await repository.updateVendorReferral(referral, tx);
          });
          qualified++;
        } catch (err) {
          log.warn({ referralId: row.id.toString(), err }, 'Failed to qualify referral');
        }
      }

      // Milestone 10
      if (customerCount >= 10 && !row.milestone10At && !row.clawedBackAt) {
        try {
          const fresh = rowToEntity(row);
          fresh.recordMilestone10();
          await repository.transaction(async (tx) => {
            await repository.updateVendorReferral(fresh, tx);
            await repository.earnCredit({
              vendorId: row.referrerVendorId,
              amount: REWARD_AMOUNTS.MILESTONE_10,
              rewardKind: ReferralRewardKind.MILESTONE_10,
              sourceType: CreditSourceType.VENDOR_REFERRAL,
              sourceId: row.id,
              description: `Milestone 10 customers for referee #${refereeId.toString()}`,
              tx,
            });
          });
          milestone10++;
        } catch (err) {
          log.warn({ referralId: row.id.toString(), err }, 'Failed to award milestone 10');
        }
      }

      // Milestone 50
      if (customerCount >= 50 && !row.milestone50At && !row.clawedBackAt) {
        try {
          const fresh = rowToEntity(row);
          fresh.recordMilestone50();
          await repository.transaction(async (tx) => {
            await repository.updateVendorReferral(fresh, tx);
            await repository.earnCredit({
              vendorId: row.referrerVendorId,
              amount: REWARD_AMOUNTS.MILESTONE_50,
              rewardKind: ReferralRewardKind.MILESTONE_50,
              sourceType: CreditSourceType.VENDOR_REFERRAL,
              sourceId: row.id,
              description: `Milestone 50 customers for referee #${refereeId.toString()}`,
              tx,
            });
          });
          milestone50++;
        } catch (err) {
          log.warn({ referralId: row.id.toString(), err }, 'Failed to award milestone 50');
        }
      }
    }

    log.info(
      { processed: referrals.length, qualified, milestone10, milestone50 },
      'MilestoneSweep: complete'
    );
  } catch (err) {
    log.error({ err }, 'MilestoneSweep: failed');
  }
}

// ============================================================
// ClawbackExpirySweep — daily 03:00 IST
// ============================================================

async function runClawbackSweep(): Promise<void> {
  const log = logger.child({ cron: 'ClawbackSweep' });
  log.info('ClawbackSweep: starting');
  try {
    const candidates = await repository.findReferralsForClawbackSweep();
    let clawedBack = 0;

    for (const row of candidates) {
      if (!row.refereeVendorId) continue;
      const refereeId = row.refereeVendorId;

      const isChurned = await subscriptionInvoiceAdapter.isSubscriptionChurned(refereeId);
      if (!isChurned) continue;

      try {
        // Query the actual amount earned for this referral to avoid over-clawing
        const actualEarned = await repository.totalEarnedForReferral(row.referrerVendorId, row.id);
        if (actualEarned <= 0) {
          log.info(
            { referralId: row.id.toString() },
            'ClawbackSweep: no credits earned yet — marking clawed back without ledger entry'
          );
        }
        await repository.transaction(async (tx) => {
          if (actualEarned > 0) {
            await repository.adjustCredit({
              vendorId: row.referrerVendorId,
              amount: actualEarned,
              description: `Clawback: referee #${refereeId.toString()} churned within ${REWARD_AMOUNTS.CLAWBACK_DAYS} days`,
              tx,
            });
          }
          await repository.updateVendorReferral(
            VendorReferral.fromPersistence({
              id: row.id,
              props: {
                referrerVendorId: row.referrerVendorId,
                refereeVendorId: row.refereeVendorId,
                referralCode: row.referralCode,
                status: row.status,
                rewardType: row.rewardType as VendorRewardType | null,
                rewardAmount: row.rewardAmount,
                refereeName: row.refereeName,
                refereePhone: row.refereePhone,
                signupDate: row.signupDate,
                firstCustomerDate: row.firstCustomerDate,
                milestone10At: row.milestone10At,
                milestone50At: row.milestone50At,
                revenueShareUntil: row.revenueShareUntil,
                clawedBackAt: new Date(),
              },
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              deletedAt: row.deletedAt,
            }),
            tx
          );
        });
        clawedBack++;
      } catch (err) {
        log.warn({ referralId: row.id.toString(), err }, 'Failed to clawback referral');
      }
    }

    log.info({ processed: candidates.length, clawedBack }, 'ClawbackSweep: complete');
  } catch (err) {
    log.error({ err }, 'ClawbackSweep: failed');
  }
}

// ============================================================
// RevenueShareSweep — monthly 1st 01:00 IST
// ============================================================

async function runRevenueShareSweep(): Promise<void> {
  const log = logger.child({ cron: 'RevenueShareSweep' });
  log.info('RevenueShareSweep: starting');
  try {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yearMonth = `${lastMonth.getFullYear().toString()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

    const referrals = await repository.findReferralsInRevenueShareWindow(yearMonth);
    let shared = 0;

    for (const row of referrals) {
      if (!row.refereeVendorId) continue;
      const refereeId = row.refereeVendorId;

      const alreadyShared = await repository.hasRevenueShareForMonth(
        row.referrerVendorId,
        row.id,
        yearMonth
      );
      if (alreadyShared) continue;

      const invoice = await subscriptionInvoiceAdapter.paidInvoiceForMonth(refereeId, yearMonth);
      if (!invoice) continue;

      const shareAmount =
        Math.round(invoice.amount * REWARD_AMOUNTS.REVENUE_SHARE_PERCENT * 100) / 100;
      if (shareAmount <= 0) continue;

      try {
        await repository.transaction(async (tx) => {
          await repository.earnCredit({
            vendorId: row.referrerVendorId,
            amount: shareAmount,
            rewardKind: ReferralRewardKind.REVENUE_SHARE,
            sourceType: CreditSourceType.VENDOR_REFERRAL,
            sourceId: row.id,
            description: `REVENUE_SHARE:${yearMonth} for referee #${refereeId.toString()}`,
            tx,
          });
        });
        shared++;
      } catch (err) {
        log.warn({ referralId: row.id.toString(), err }, 'Failed to apply revenue share');
      }
    }

    log.info({ yearMonth, processed: referrals.length, shared }, 'RevenueShareSweep: complete');
  } catch (err) {
    log.error({ err }, 'RevenueShareSweep: failed');
  }
}

// ============================================================
// InviteResendSweep — daily 09:00 IST
// ============================================================

function runInviteResendSweep(): void {
  const log = logger.child({ cron: 'InviteResendSweep' });
  log.info('InviteResendSweep: starting — stub (real WhatsApp resend not implemented in v1)');
}

// ============================================================
// LeaderboardRecompute — weekly Mon 04:00 IST
// ============================================================

async function runLeaderboardRecompute(): Promise<void> {
  const log = logger.child({ cron: 'LeaderboardRecompute' });
  log.info('LeaderboardRecompute: starting');
  try {
    const now = new Date();
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const allTimeStart = new Date(2024, 0, 1);

    const periods: Array<{ type: LeaderboardPeriodType; start: Date }> = [
      { type: LeaderboardPeriodType.WEEKLY, start: startOfWeek },
      { type: LeaderboardPeriodType.MONTHLY, start: startOfMonth },
      { type: LeaderboardPeriodType.ALL_TIME, start: allTimeStart },
    ];

    const { prisma } = await import('@/infrastructure/database/prisma.client');

    const aggregates = await prisma.vendorReferral.groupBy({
      by: ['referrerVendorId'],
      where: { deletedAt: null },
      _count: { id: true },
    });

    const qualifiedGroups = await prisma.vendorReferral.groupBy({
      by: ['referrerVendorId'],
      where: {
        status: { in: ['QUALIFIED', 'REWARDED'] },
        deletedAt: null,
      },
      _count: { id: true },
    });
    const qualifiedMap = new Map(qualifiedGroups.map((q) => [q.referrerVendorId, q._count.id]));

    const credits = await prisma.vendorCredit.findMany({
      select: { vendorId: true, lifetimeCreditsEarned: true },
    });
    const creditMap = new Map(credits.map((c) => [c.vendorId, Number(c.lifetimeCreditsEarned)]));

    // Sort by total referrals desc
    aggregates.sort((a, b) => b._count.id - a._count.id);

    for (const period of periods) {
      for (let i = 0; i < aggregates.length; i++) {
        const agg = aggregates[i];
        if (!agg) continue;
        await repository.upsertLeaderboardEntry({
          vendorId: agg.referrerVendorId,
          periodType: period.type,
          periodStart: period.start,
          rankPosition: i + 1,
          totalReferrals: agg._count.id,
          qualifiedReferrals: qualifiedMap.get(agg.referrerVendorId) ?? 0,
          rewardEarned: creditMap.get(agg.referrerVendorId) ?? 0,
          computedAt: now,
        });
      }
    }

    log.info('LeaderboardRecompute: complete');
  } catch (err) {
    log.error({ err }, 'LeaderboardRecompute: failed');
  }
}

// ============================================================
// Registration
// ============================================================

export function registerReferralCrons(): void {
  if (process.env['ENABLE_CRON'] !== 'true') {
    logger.info('Referral crons: ENABLE_CRON not set — skipping registration');
    return;
  }

  // MilestoneSweep: daily 02:00 IST
  cron.schedule('0 2 * * *', () => void runMilestoneSweep(), { timezone: 'Asia/Kolkata' });

  // ClawbackExpirySweep: daily 03:00 IST
  cron.schedule('0 3 * * *', () => void runClawbackSweep(), { timezone: 'Asia/Kolkata' });

  // InviteResendSweep: daily 09:00 IST
  cron.schedule('0 9 * * *', () => runInviteResendSweep(), { timezone: 'Asia/Kolkata' });

  // RevenueShareSweep: monthly 1st 01:00 IST
  cron.schedule('0 1 1 * *', () => void runRevenueShareSweep(), { timezone: 'Asia/Kolkata' });

  // LeaderboardRecompute: weekly Mon 04:00 IST
  cron.schedule('0 4 * * 1', () => void runLeaderboardRecompute(), { timezone: 'Asia/Kolkata' });

  logger.info(
    'Referral crons: registered (MilestoneSweep, ClawbackSweep, InviteResend, RevenueShare, Leaderboard)'
  );
}
