/**
 * CustomerReferralsQuery — summary + top referrers + recent additions.
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';
import { prisma } from '@/infrastructure/database/prisma.client';

export interface CustomerReferralsInput {
  vendorId: bigint;
  page: number;
  limit: number;
}

export interface CustomerReferralsResult {
  summary: { newThisMonth: number; totalFromReferrals: number; percentageOfBase: number };
  topReferrers: Array<{ customerId: string; customerName: string | null; referralCount: number }>;
  recentAdditions: Array<{
    referredCustomerName: string | null;
    referrerCustomerName: string | null;
    joinedDate: string;
  }>;
  total: number;
}

export class CustomerReferralsQuery {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: CustomerReferralsInput): Promise<CustomerReferralsResult> {
    this.logger.info({ vendorId: input.vendorId.toString() }, 'CustomerReferralsQuery');

    const [summary, topReferrers, { rows: recentRows, total }] = await Promise.all([
      this.repository.findCustomerReferralSummary(input.vendorId),
      this.repository.findTopReferrers(input.vendorId, 5),
      this.repository.listRecentCustomerReferrals(input.vendorId, input.page, input.limit),
    ]);

    const percentageOfBase =
      summary.totalCustomers > 0
        ? Math.round((summary.totalFromReferrals / summary.totalCustomers) * 100 * 10) / 10
        : 0;

    // Enrich recent additions with customer names
    const customerIds = [
      ...new Set([
        ...recentRows.map((r) => r.referrerCustomerId),
        ...recentRows.map((r) => r.refereeCustomerId),
      ]),
    ];

    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true },
    });
    const customerNameMap = new Map(customers.map((c) => [c.id, c.name]));

    const recentAdditions = recentRows.map((r) => ({
      referredCustomerName: customerNameMap.get(r.refereeCustomerId) ?? null,
      referrerCustomerName: customerNameMap.get(r.referrerCustomerId) ?? null,
      joinedDate: r.createdAt.toISOString(),
    }));

    return {
      summary: {
        newThisMonth: summary.newThisMonth,
        totalFromReferrals: summary.totalFromReferrals,
        percentageOfBase,
      },
      topReferrers: topReferrers.map((r) => ({
        customerId: r.customerId.toString(),
        customerName: r.customerName,
        referralCount: r.referralCount,
      })),
      recentAdditions,
      total,
    };
  }
}
