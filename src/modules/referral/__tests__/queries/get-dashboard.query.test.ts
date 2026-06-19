/**
 * Unit tests — GetDashboardQuery.
 * Covers:
 *  - cache hit short-circuits the build (no repository reads)
 *  - cache miss builds then populates the cache
 *  - N+1 elimination: earned breakdown + customer counts are each fetched ONCE
 *    (batched), regardless of referral count
 *  - response contract (golden snapshot) is preserved
 *  - edge cases: zero referrals, referral with no earned transactions
 */
import {
  GetDashboardQuery,
  DashboardResult,
} from '../../queries/get-dashboard/get-dashboard.query';
import {
  IReferralRepository,
  VendorReferralRow,
  ReferralEarnedBreakdown,
} from '../../database/referral.repository.port';
import { ICustomerCountPort } from '../../ports/customer-count.port';
import { IDashboardCachePort } from '../../ports/dashboard-cache.port';
import { ReferralVendorStatus } from '../../domain/vendor-referral.types';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const vendorId = BigInt(100);

function makeReferralRow(over: Partial<VendorReferralRow> & { id: bigint }): VendorReferralRow {
  return {
    referrerVendorId: vendorId,
    refereeVendorId: BigInt(Number(over.id) + 1000),
    referralCode: 'CODE',
    status: ReferralVendorStatus.SIGNED_UP,
    rewardType: null,
    rewardAmount: null,
    refereeName: `Referee ${over.id.toString()}`,
    refereePhone: '9999999999',
    signupDate: new Date('2026-01-01T00:00:00.000Z'),
    firstCustomerDate: null,
    milestone10At: null,
    milestone50At: null,
    revenueShareUntil: null,
    clawedBackAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...over,
  };
}

function makeCache(): jest.Mocked<IDashboardCachePort<DashboardResult>> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
}

function makeCustomerCountPort(
  countMap: Map<bigint, number> = new Map()
): jest.Mocked<ICustomerCountPort> {
  return {
    activeCustomerCount: jest.fn(),
    customersAddedWithinDays: jest.fn(),
    activeCustomerCountByVendor: jest.fn().mockResolvedValue(countMap),
  };
}

function makeRepo(opts: {
  referrals: VendorReferralRow[];
  earned?: Map<bigint, ReferralEarnedBreakdown>;
  referralCode?: string | null;
}): jest.Mocked<IReferralRepository> {
  const repo = {
    getVendorReferralCode: jest.fn().mockResolvedValue(opts.referralCode ?? 'EXISTING'),
    getVendorName: jest.fn().mockResolvedValue('Acme'),
    isReferralCodeUnique: jest.fn().mockResolvedValue(true),
    setVendorReferralCode: jest.fn().mockResolvedValue(undefined),
    getVendorCreditBalance: jest.fn().mockResolvedValue({
      id: BigInt(1),
      vendorId,
      availableCredits: 1500,
      lifetimeCreditsEarned: 1500,
      lifetimeCreditsUsed: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    listVendorReferrals: jest
      .fn()
      .mockResolvedValue({ rows: opts.referrals, total: opts.referrals.length }),
    earnedBreakdownByReferral: jest.fn().mockResolvedValue(opts.earned ?? new Map()),
    findCustomerReferralSummary: jest
      .fn()
      .mockResolvedValue({ newThisMonth: 2, totalFromReferrals: 5, totalCustomers: 10 }),
    findTopReferrers: jest
      .fn()
      .mockResolvedValue([{ customerId: BigInt(1), customerName: 'Top', referralCount: 3 }]),
    // unused-by-dashboard methods that must not be called for ledger reads
    listCreditTransactions: jest.fn(),
  } as unknown as jest.Mocked<IReferralRepository>;
  return repo;
}

describe('GetDashboardQuery', () => {
  it('returns the cached DTO on a hit without touching the repository', async () => {
    const cache = makeCache();
    const cachedDto = { referralCode: 'CACHED' } as unknown as DashboardResult;
    cache.get.mockResolvedValue(cachedDto);

    const repo = makeRepo({ referrals: [] });
    const counts = makeCustomerCountPort();
    const qry = new GetDashboardQuery(repo, counts, cache, logger);

    const result = await qry.execute(vendorId);

    expect(result).toBe(cachedDto);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repo.listVendorReferrals).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('builds and populates the cache on a miss', async () => {
    const cache = makeCache();
    const repo = makeRepo({ referrals: [] });
    const counts = makeCustomerCountPort();
    const qry = new GetDashboardQuery(repo, counts, cache, logger);

    await qry.execute(vendorId);

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.set.mock.calls[0]?.[0]).toBe(vendorId);
  });

  it('fetches earned breakdown and customer counts ONCE regardless of referral count (no N+1)', async () => {
    const referrals = Array.from({ length: 50 }, (_, i) => makeReferralRow({ id: BigInt(i + 1) }));
    const counts = makeCustomerCountPort(
      new Map(referrals.map((r) => [r.refereeVendorId as bigint, 7]))
    );
    const repo = makeRepo({ referrals });
    const qry = new GetDashboardQuery(repo, counts, makeCache(), logger);

    await qry.execute(vendorId);

    // Exactly one aggregate query for earned breakdown.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repo.earnedBreakdownByReferral).toHaveBeenCalledTimes(1);
    // Exactly one batched customer-count query.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(counts.activeCustomerCountByVendor).toHaveBeenCalledTimes(1);
    // Per-referral ledger reads and per-referral counts must NOT be used.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repo.listCreditTransactions).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(counts.activeCustomerCount).not.toHaveBeenCalled();
  });

  it('preserves the dashboard response contract (golden snapshot)', async () => {
    const r1 = makeReferralRow({ id: BigInt(1) });
    const r2 = makeReferralRow({
      id: BigInt(2),
      milestone10At: new Date('2026-02-01T00:00:00.000Z'),
    });
    const earned = new Map<bigint, ReferralEarnedBreakdown>([
      [BigInt(1), { signup: 500, milestone10: 1000, milestone50: 0, revenueShare: 120 }],
      // r2 has no earned rows → defaults to zeros
    ]);
    const counts = makeCustomerCountPort(
      new Map([
        [r1.refereeVendorId as bigint, 4],
        [r2.refereeVendorId as bigint, 12],
      ])
    );
    const repo = makeRepo({ referrals: [r1, r2], earned });
    const qry = new GetDashboardQuery(repo, counts, makeCache(), logger);

    const result = await qry.execute(vendorId);

    expect(result).toMatchSnapshot();
  });

  it('handles a vendor with zero referrals (empty state)', async () => {
    const repo = makeRepo({ referrals: [] });
    const counts = makeCustomerCountPort();
    const qry = new GetDashboardQuery(repo, counts, makeCache(), logger);

    const result = await qry.execute(vendorId);

    expect(result.vendorReferrals).toEqual([]);
    expect(result.totalEarnings).toEqual({ credits: 0, revenueShare: 0, total: 0 });
  });

  it('defaults earned breakdown to zeros for a referral with no earned transactions', async () => {
    const r1 = makeReferralRow({ id: BigInt(1) });
    const repo = makeRepo({ referrals: [r1], earned: new Map() });
    const counts = makeCustomerCountPort(new Map([[r1.refereeVendorId as bigint, 0]]));
    const qry = new GetDashboardQuery(repo, counts, makeCache(), logger);

    const result = await qry.execute(vendorId);

    expect(result.vendorReferrals[0]?.earned).toEqual({
      signup: 0,
      milestone10: 0,
      milestone50: 0,
      revenueShare: 0,
      total: 0,
    });
  });
});
