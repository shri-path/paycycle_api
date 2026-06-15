/**
 * GetDashboardQuery — full referral dashboard.
 * Also exposes referralCode (lazily generated).
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';
import { ICustomerCountPort } from '../../ports/customer-count.port';
import { ReferralRewardKind, REWARD_AMOUNTS } from '../../domain/vendor-referral.types';
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
    private readonly logger: Logger
  ) {}

  async execute(vendorId: bigint): Promise<DashboardResult> {
    this.logger.info({ vendorId: vendorId.toString() }, 'GetDashboardQuery: fetching dashboard');

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

    // Per-referral earnings from credit_transactions
    const vendorReferralsData = await Promise.all(
      referralRows.map(async (r) => {
        const customerCount = r.refereeVendorId
          ? await this.customerCountPort.activeCustomerCount(r.refereeVendorId)
          : 0;

        // Compute earned from ledger
        const { rows: txns } = await this.repository.listCreditTransactions(vendorId, 1, 100);
        const referralTxns = txns.filter((t) => t.sourceId === r.id);

        let signupEarned = 0;
        let milestone10Earned = 0;
        let milestone50Earned = 0;
        let revenueShareEarned = 0;

        for (const t of referralTxns) {
          switch (t.rewardKind) {
            case ReferralRewardKind.SIGNUP_BONUS:
              signupEarned += t.amount;
              break;
            case ReferralRewardKind.MILESTONE_10:
              milestone10Earned += t.amount;
              break;
            case ReferralRewardKind.MILESTONE_50:
              milestone50Earned += t.amount;
              break;
            case ReferralRewardKind.REVENUE_SHARE:
              revenueShareEarned += t.amount;
              break;
          }
        }

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
      })
    );

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
