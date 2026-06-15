/**
 * NearbyVendorsQuery — v1 locality string-match (no PostGIS).
 * USER DECISION: radius is echoed back but not used. distance is null.
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';

export interface NearbyVendorsInput {
  vendorId: bigint;
  radius?: number;
}

export interface NearbyVendorsResult {
  yourBusiness: { name: string; customersOnPaycycle: number; rankInArea: number };
  byCategory: Record<
    string,
    Array<{ name: string; customersOnPaycycle: number; distance: null; yourReferral: boolean }>
  >;
  totalVendorsInRadius: number;
  totalCustomersInRadius: number;
  radius: number;
}

export class NearbyVendorsQuery {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: NearbyVendorsInput): Promise<NearbyVendorsResult> {
    this.logger.info(
      { vendorId: input.vendorId.toString() },
      'NearbyVendorsQuery: finding nearby vendors (locality string-match)'
    );

    const radius = input.radius ?? 2;

    // Get caller's vendor info
    const callerName = await this.repository.getVendorName(input.vendorId);
    const { prisma } = await import('@/infrastructure/database/prisma.client');
    const callerVendor = await prisma.vendor.findUnique({
      where: { id: input.vendorId },
      select: { name: true, category: true },
    });

    // Get caller's customer count (on PayCycle = vendor_customers count)
    const { rows: callerReferrals } = await this.repository.listVendorReferrals(
      input.vendorId,
      1,
      1000
    );
    const referredVendorIds = new Set(
      callerReferrals.map((r) => r.refereeVendorId).filter(Boolean) as bigint[]
    );

    // Find nearby vendors (locality match)
    const nearbyVendors = await this.repository.findNearbyVendors(input.vendorId);

    // Get caller's customer count on PayCycle
    const callerCustomerCount = await prisma.vendorCustomer.count({
      where: { vendorId: input.vendorId, deletedAt: null },
    });

    // Build byCategory
    const byCategory: NearbyVendorsResult['byCategory'] = {};

    for (const v of nearbyVendors) {
      const cat = (v.category ?? 'other').toLowerCase();
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push({
        name: v.vendorName,
        customersOnPaycycle: v.customerCount,
        distance: null, // no PostGIS in v1
        yourReferral: referredVendorIds.has(v.vendorId),
      });
    }

    // Rank in area: sort all vendors by customerCount desc, find caller's rank
    const allCounts = [
      { vendorId: input.vendorId, count: callerCustomerCount },
      ...nearbyVendors.map((v) => ({ vendorId: v.vendorId, count: v.customerCount })),
    ];
    allCounts.sort((a, b) => b.count - a.count);
    const rank = allCounts.findIndex((v) => v.vendorId === input.vendorId) + 1;

    const totalCustomersInRadius = nearbyVendors.reduce((sum, v) => sum + v.customerCount, 0);

    return {
      yourBusiness: {
        name: callerVendor?.name ?? callerName ?? 'Your Business',
        customersOnPaycycle: callerCustomerCount,
        rankInArea: rank,
      },
      byCategory,
      totalVendorsInRadius: nearbyVendors.length,
      totalCustomersInRadius,
      radius,
    };
  }
}
