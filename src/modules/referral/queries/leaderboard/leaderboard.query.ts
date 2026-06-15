/**
 * LeaderboardQuery — pre-computed leaderboard for a period.
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';
import { LeaderboardPeriodType } from '../../domain/vendor-referral.types';

export interface LeaderboardInput {
  vendorId: bigint;
  period: LeaderboardPeriodType;
  page: number;
  limit: number;
}

export interface LeaderboardItem {
  vendorId: string;
  vendorName: string;
  totalReferrals: number;
  qualifiedReferrals: number;
  rankPosition: number;
  rewardEarned: number;
  isYou: boolean;
}

export class LeaderboardQuery {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: LeaderboardInput): Promise<{ rows: LeaderboardItem[]; total: number }> {
    this.logger.info(
      { vendorId: input.vendorId.toString(), period: input.period },
      'LeaderboardQuery'
    );

    const { rows, total } = await this.repository.listLeaderboard(
      input.period,
      input.page,
      input.limit
    );

    const vendorIds = rows.map((r) => r.vendorId);
    const vendorNameMap = await this.repository.findVendorNamesByIds(vendorIds);

    return {
      rows: rows.map((r) => ({
        vendorId: r.vendorId.toString(),
        vendorName: vendorNameMap.get(r.vendorId) ?? `Vendor #${r.vendorId.toString()}`,
        totalReferrals: r.totalReferrals,
        qualifiedReferrals: r.qualifiedReferrals,
        rankPosition: r.rankPosition,
        rewardEarned: r.rewardEarned,
        isYou: r.vendorId === input.vendorId,
      })),
      total,
    };
  }
}
