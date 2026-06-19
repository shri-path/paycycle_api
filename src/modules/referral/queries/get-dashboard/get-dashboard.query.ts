/**
 * GetDashboardQuery — full referral dashboard.
 * Also exposes referralCode (lazily generated).
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';
import { ICustomerCountPort } from '../../ports/customer-count.port';
import { IDashboardCachePort } from '../../ports/dashboard-cache.port';
import { REWARD_AMOUNTS } from '../../domain/vendor-referral.types';
import { ReferralCode } from '../../domain/value-objects/referral-code.vo';

export interface DashboardResult {
  referralCode: string | null;
  totalEarnings: { credits: number; revenueShare: number; total: number };
  availableBalance: number;
  vendorReferrals: Array<{
    id: string;
    referredVendorName: string;
    referredDate: string;
    status: string;
    customerCount: number;
    earned: {
      signup: number;
      milestone10: number;
      milestone50: number;
      revenueShare: number;
      total: number;
    };
    nextMilestone: { type: string | null; reward: number; progress: number; target: number } | null;
  }>;
  customerGrowthFromReferrals: {
    newCustomersThisMonth: number;
    totalFromReferrals: number;
    additionalMonthlyRevenue: number;
    topReferrer: { customerName: string | null; referralCount: number } | null;
  };
}

export class GetDashboardQuery {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly customerCountPort: ICustomerCountPort,
    private readonly cache: IDashboardCachePort<DashboardResult>,
    private readonly logger: Logger
  ) {}

  async execute(vendorId: bigint): Promise<DashboardResult> {
    this.logger.info({ vendorId: vendorId.toString() }, 'GetDashboardQuery: fetching dashboard');

    // Serve from per-tenant cache when warm (5-min TTL).
    const cached = await this.cache.get(vendorId);
    if (cached) {
      this.logger.debug({ vendorId: vendorId.toString() }, 'GetDashboardQuery: cache hit');
      return cached;
    }

    const result = await this.build(vendorId);
    await this.cache.set(vendorId, result);
    return result;
  }

  private async build(vendorId: bigint): Promise<DashboardResult> {
    // Lazily generate referral code if absent
    let referralCode = await this.repository.getVendorReferralCode(vendorId);
    if (!referralCode) {
      const vendorName = (await this.repository.getVendorName(vendorId)) ?? 'Vendor';
      for (let i = 0; i < 10; i++) {
        const code = ReferralCode.generate(vendorName).value;
        const unique = await this.repository.isReferralCodeUnique(code, vendorId);
        if (unique) {
          await this.repository.setVendorReferralCode(vendorId, code);
          referralCode = code;
          break;
        }
      }
    }

    // Credit balance
    const creditRow = await this.repository.getVendorCreditBalance(vendorId);
    const availableBalance = creditRow?.availableCredits ?? 0;

    // Vendor referrals list
    const { rows: referralRows } = await this.repository.listVendorReferrals(vendorId, 1, 50);

    // --- N+1 elimination ---
    // 1) Single groupBy aggregate: per-referral earned breakdown across the whole ledger.
    const earnedByReferral = await this.repository.earnedBreakdownByReferral(vendorId);

    // 2) Single batched query: active customer count for all referee vendors at once.
    const refereeVendorIds = referralRows
      .map((r) => r.refereeVendorId)
      .filter((id): id is bigint => id !== null);
    const customerCountByVendor =
      await this.customerCountPort.activeCustomerCountByVendor(refereeVendorIds);

    // Per-referral assembly from the pre-built maps (no per-row DB round-trips).
    const vendorReferralsData = referralRows.map((r) => {
      const customerCount = r.refereeVendorId
        ? (customerCountByVendor.get(r.refereeVendorId) ?? 0)
        : 0;

      const breakdown = earnedByReferral.get(r.id) ?? {
        signup: 0,
        milestone10: 0,
        milestone50: 0,
        revenueShare: 0,
      };
      const signupEarned = breakdown.signup;
      const milestone10Earned = breakdown.milestone10;
      const milestone50Earned = breakdown.milestone50;
      const revenueShareEarned = breakdown.revenueShare;

      const total = signupEarned + milestone10Earned + milestone50Earned + revenueShareEarned;

      // Next milestone
      let nextMilestone: DashboardResult['vendorReferrals'][0]['nextMilestone'] = null;
      if (!r.milestone10At) {
        nextMilestone = {
          type: '10_customers',
          reward: REWARD_AMOUNTS.MILESTONE_10,
          progress: customerCount,
          target: 10,
        };
      } else if (!r.milestone50At) {
        nextMilestone = {
          type: '50_customers',
          reward: REWARD_AMOUNTS.MILESTONE_50,
          progress: customerCount,
          target: 50,
        };
      }

      return {
        id: r.id.toString(),
        referredVendorName:
          r.refereeName ?? `Vendor #${r.refereeVendorId?.toString() ?? 'unknown'}`,
        referredDate: r.createdAt.toISOString(),
        status: r.status,
        customerCount,
        earned: {
          signup: signupEarned,
          milestone10: milestone10Earned,
          milestone50: milestone50Earned,
          revenueShare: revenueShareEarned,
          total,
        },
        nextMilestone,
      };
    });

    // Aggregate totals
    let totalCredits = 0;
    let totalRevenueShare = 0;
    for (const vr of vendorReferralsData) {
      totalCredits += vr.earned.signup + vr.earned.milestone10 + vr.earned.milestone50;
      totalRevenueShare += vr.earned.revenueShare;
    }

    // Customer growth from referrals
    const customerSummary = await this.repository.findCustomerReferralSummary(vendorId);
    const topReferrers = await this.repository.findTopReferrers(vendorId, 1);
    const topReferrer = topReferrers[0]
      ? { customerName: topReferrers[0].customerName, referralCount: topReferrers[0].referralCount }
      : null;

    return {
      referralCode,
      totalEarnings: {
        credits: totalCredits,
        revenueShare: totalRevenueShare,
        total: totalCredits + totalRevenueShare,
      },
      availableBalance,
      vendorReferrals: vendorReferralsData,
      customerGrowthFromReferrals: {
        newCustomersThisMonth: customerSummary.newThisMonth,
        totalFromReferrals: customerSummary.totalFromReferrals,
        additionalMonthlyRevenue: 0, // not calculable without billing data
        topReferrer,
      },
    };
  }
}
