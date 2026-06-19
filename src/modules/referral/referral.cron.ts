/**
 * Referral cron jobs — gated behind ENABLE_CRON=true.
 * Timezone: Asia/Kolkata
 */
import crypto from 'crypto';
import cron from 'node-cron';
import { logger } from '@/infrastructure/logger/logger';
import { AuditLogger } from '@/common/audit/audit-logger';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { ReferralRepository } from './database/referral.repository';
import { CustomerCountAdapter } from './database/customer-count.adapter';
import { SubscriptionInvoiceAdapter } from './database/subscription-invoice.adapter';
import { StubInviteMessageAdapter } from './database/invite-message.adapter';
import { IInviteMessagePort } from './ports/invite-message.port';
import { dashboardCache } from './database/dashboard-cache.instance';
import {
  ReferralVendorStatus,
  ReferralRewardKind,
  CreditSourceType,
  VendorRewardType,
  LeaderboardPeriodType,
  REWARD_AMOUNTS,
} from './domain/vendor-referral.types';
import { VendorReferral } from './domain/vendor-referral.entity';
import { VendorReferralRow, IReferralRepository } from './database/referral.repository.port';
import { referralEvents } from './database/referral-events.instance';
import {
  ReferralRewardEarnedEvent,
  ReferralRewardClawedBackEvent,
  VendorReferralQualifiedEvent,
} from './domain/events/vendor-referral.domain-events';

const repository = new ReferralRepository();
const customerCountAdapter = new CustomerCountAdapter();
const subscriptionInvoiceAdapter = new SubscriptionInvoiceAdapter();
const auditLogger = new AuditLogger(logger);
const inviteMessagePort: IInviteMessagePort = new StubInviteMessageAdapter();

/**
 * Max invites processed per InviteResendSweep run (US-15.4). Bounds the per-run
 * scan/send so a large backlog drains across successive daily runs instead of one
 * unbounded blast. US-15.5 will layer a ≤50/min rate limiter on top of this cap;
 * this batch size is deliberately compatible with that future pacing.
 */
const INVITE_RESEND_BATCH_SIZE = 100;

/**
 * Emit a referral reward-earned audit entry from a cron path (US-15.2).
 * Actor is `system` (no request user). Best-effort: AuditLogger swallows its
 * own failures so a failed audit never affects the already-committed ledger row.
 */
async function auditRewardEarned(params: {
  referrerVendorId: bigint;
  referralId: bigint;
  refereeVendorId: bigint;
  amount: number;
  rewardKind: ReferralRewardKind;
  correlationId: string;
}): Promise<void> {
  await auditLogger.log({
    vendorId: params.referrerVendorId,
    performedByUserId: null,
    performedByRole: 'system',
    action: AuditAction.REFERRAL_REWARD_EARNED,
    entityType: 'vendor_referral',
    entityId: params.referralId,
    metadata: {
      amount: params.amount,
      rewardKind: params.rewardKind,
      refereeVendorId: params.refereeVendorId.toString(),
      correlationId: params.correlationId,
    },
    correlationId: params.correlationId,
  });
}

/**
 * Publish ReferralRewardEarned from a cron reward path (US-15.3) so the referrer is
 * notified. Published only after the reward row is committed and inside the existing
 * dedup guards (milestone10At/50At, hasRevenueShareForMonth), so it is idempotent.
 * Best-effort: the dispatcher swallows handler errors so it never affects the cron run.
 */
async function publishRewardEarned(params: {
  referrerVendorId: bigint;
  referralId: bigint;
  amount: number;
  rewardKind: ReferralRewardKind;
  correlationId: string;
}): Promise<void> {
  await referralEvents.publish(
    new ReferralRewardEarnedEvent({
      aggregateId: params.referralId.toString(),
      vendorId: params.referrerVendorId.toString(),
      amount: params.amount,
      rewardKind: params.rewardKind,
      metadata: { correlationId: params.correlationId },
    })
  );
}

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
  const runCorrelationId = crypto.randomUUID();
  const log = logger.child({ cron: 'MilestoneSweep', correlationId: runCorrelationId });
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
          // US-15.3: referral transitioned SIGNED_UP → QUALIFIED.
          await referralEvents.publish(
            new VendorReferralQualifiedEvent({
              aggregateId: row.id.toString(),
              referrerVendorId: row.referrerVendorId.toString(),
              refereeVendorId: refereeId.toString(),
              metadata: { correlationId: runCorrelationId },
            })
          );
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
          await dashboardCache.invalidate(row.referrerVendorId);
          await auditRewardEarned({
            referrerVendorId: row.referrerVendorId,
            referralId: row.id,
            refereeVendorId: refereeId,
            amount: REWARD_AMOUNTS.MILESTONE_10,
            rewardKind: ReferralRewardKind.MILESTONE_10,
            correlationId: runCorrelationId,
          });
          await publishRewardEarned({
            referrerVendorId: row.referrerVendorId,
            referralId: row.id,
            amount: REWARD_AMOUNTS.MILESTONE_10,
            rewardKind: ReferralRewardKind.MILESTONE_10,
            correlationId: runCorrelationId,
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
          await dashboardCache.invalidate(row.referrerVendorId);
          await auditRewardEarned({
            referrerVendorId: row.referrerVendorId,
            referralId: row.id,
            refereeVendorId: refereeId,
            amount: REWARD_AMOUNTS.MILESTONE_50,
            rewardKind: ReferralRewardKind.MILESTONE_50,
            correlationId: runCorrelationId,
          });
          await publishRewardEarned({
            referrerVendorId: row.referrerVendorId,
            referralId: row.id,
            amount: REWARD_AMOUNTS.MILESTONE_50,
            rewardKind: ReferralRewardKind.MILESTONE_50,
            correlationId: runCorrelationId,
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
  const runCorrelationId = crypto.randomUUID();
  const log = logger.child({ cron: 'ClawbackSweep', correlationId: runCorrelationId });
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
        // Clawback changed the referrer's balance/earnings — drop their cache.
        await dashboardCache.invalidate(row.referrerVendorId);

        // Audit the clawback. Records the ACTUAL reversed amount (clamped to what
        // was earned — see actualEarned above), not the nominal earned sum. When
        // nothing was earned (actualEarned === 0) no ledger row was written, but we
        // still audit the referral being marked clawed-back for traceability.
        await auditLogger.log({
          vendorId: row.referrerVendorId,
          performedByUserId: null,
          performedByRole: 'system',
          action: AuditAction.REFERRAL_CREDIT_CLAWED_BACK,
          entityType: 'vendor_referral',
          entityId: row.id,
          metadata: {
            amount: actualEarned,
            refereeVendorId: refereeId.toString(),
            reason: 'churn',
            clawbackWindowDays: REWARD_AMOUNTS.CLAWBACK_DAYS,
            correlationId: runCorrelationId,
          },
          correlationId: runCorrelationId,
        });
        // US-15.3: publish CreditClawedBack (post-commit, best-effort) carrying the
        // ACTUAL reversed amount (clamped to what was earned, like the audit above).
        await referralEvents.publish(
          new ReferralRewardClawedBackEvent({
            aggregateId: row.id.toString(),
            vendorId: row.referrerVendorId.toString(),
            referralId: row.id.toString(),
            amount: actualEarned,
            metadata: { correlationId: runCorrelationId },
          })
        );
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
  const runCorrelationId = crypto.randomUUID();
  const log = logger.child({ cron: 'RevenueShareSweep', correlationId: runCorrelationId });
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
        await dashboardCache.invalidate(row.referrerVendorId);
        await auditRewardEarned({
          referrerVendorId: row.referrerVendorId,
          referralId: row.id,
          refereeVendorId: refereeId,
          amount: shareAmount,
          rewardKind: ReferralRewardKind.REVENUE_SHARE,
          correlationId: runCorrelationId,
        });
        await publishRewardEarned({
          referrerVendorId: row.referrerVendorId,
          referralId: row.id,
          amount: shareAmount,
          rewardKind: ReferralRewardKind.REVENUE_SHARE,
          correlationId: runCorrelationId,
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

/**
 * Collaborators for {@link runInviteResendSweep}. Injectable so the sweep can be
 * unit-tested against mocked ports without a live DB; production registration uses
 * the module-level singletons via the defaults.
 */
export interface InviteResendSweepDeps {
  repository: Pick<
    IReferralRepository,
    | 'findInvitesDueForResendBatch'
    | 'getVendorReferralCode'
    | 'incrementInviteAttempt'
    | 'updateInviteStatus'
    | 'transaction'
  >;
  messagePort: IInviteMessagePort;
  batchSize?: number;
}

export async function runInviteResendSweep(deps?: InviteResendSweepDeps): Promise<void> {
  const repo = deps?.repository ?? repository;
  const messagePort = deps?.messagePort ?? inviteMessagePort;
  const batchSize = deps?.batchSize ?? INVITE_RESEND_BATCH_SIZE;

  const runCorrelationId = crypto.randomUUID();
  const log = logger.child({ cron: 'InviteResendSweep', correlationId: runCorrelationId });
  log.info('InviteResendSweep: starting');
  try {
    const due = await repo.findInvitesDueForResendBatch(batchSize);

    let resent = 0;
    let failedOut = 0; // invites that reached max_attempts this run → marked FAILED
    let errored = 0; // invites skipped due to an unexpected error

    // Per-vendor referral code is needed to build the invite link. Cache lookups
    // within a run so a vendor with many due invites is queried once.
    const referralCodeCache = new Map<string, string | null>();

    for (const invite of due) {
      try {
        const vendorKey = invite.vendorId.toString();
        let referralCode = referralCodeCache.get(vendorKey);
        if (referralCode === undefined) {
          referralCode = await repo.getVendorReferralCode(invite.vendorId);
          referralCodeCache.set(vendorKey, referralCode);
        }

        if (!referralCode) {
          // No code on the vendor → cannot build a valid invite link. Skip without
          // mutating state; a code is normally created when invites are first sent.
          log.warn(
            { inviteId: invite.id.toString(), vendorId: vendorKey },
            'InviteResendSweep: vendor has no referral code — skipping resend'
          );
          continue;
        }

        const referralLink = `https://paycycle.app/join?ref=${referralCode}`;
        const language = invite.messageLanguage ?? 'hi';
        const body = `Reminder: join PayCycle using code ${referralCode}: ${referralLink}`;

        // Transport is best-effort. Whether it succeeds or fails we still increment
        // the attempt (edge case #3): a permanently failing transport must still
        // count toward max_attempts so the invite eventually stops (anti-spam).
        const result = await messagePort.send({
          phone: invite.phone,
          body,
          language,
        });
        if (!result.success) {
          log.warn(
            { inviteId: invite.id.toString() },
            'InviteResendSweep: transport reported failure — still counting the attempt'
          );
        }

        // attempt_count after this resend.
        const nextAttempt = invite.attemptCount + 1;
        const reachedMax = nextAttempt >= invite.maxAttempts;

        await repo.transaction(async (tx) => {
          await repo.incrementInviteAttempt(invite.id, tx);
          if (reachedMax) {
            // Anti-spam stop: final allowed attempt sent → mark FAILED so it is
            // never picked up again.
            await repo.updateInviteStatus(invite.id, 'FAILED', tx);
          }
        });

        resent++;
        if (reachedMax) {
          failedOut++;
          log.info(
            { inviteId: invite.id.toString(), attemptCount: nextAttempt },
            'InviteResendSweep: invite reached max attempts — marked FAILED'
          );
        }
      } catch (err) {
        errored++;
        log.warn(
          { inviteId: invite.id.toString(), err },
          'InviteResendSweep: failed to process invite'
        );
      }
    }

    log.info(
      { processed: due.length, resent, failedOut, errored, batchSize },
      'InviteResendSweep: complete'
    );
  } catch (err) {
    log.error({ err }, 'InviteResendSweep: failed');
  }
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
  cron.schedule('0 9 * * *', () => void runInviteResendSweep(), { timezone: 'Asia/Kolkata' });

  // RevenueShareSweep: monthly 1st 01:00 IST
  cron.schedule('0 1 1 * *', () => void runRevenueShareSweep(), { timezone: 'Asia/Kolkata' });

  // LeaderboardRecompute: weekly Mon 04:00 IST
  cron.schedule('0 4 * * 1', () => void runLeaderboardRecompute(), { timezone: 'Asia/Kolkata' });

  logger.info(
    'Referral crons: registered (MilestoneSweep, ClawbackSweep, InviteResend, RevenueShare, Leaderboard)'
  );
}
