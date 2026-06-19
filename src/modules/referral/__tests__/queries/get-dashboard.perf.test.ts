/**
 * Performance / regression test — GetDashboardQuery at scale.
 *
 * Story US-15.1 DoD: "Performance tested with 1000+ referrals" + "query count does
 * not scale with referral count (no N+1)".
 *
 * This test drives the REAL GetDashboardQuery against an instrumented in-memory
 * repository + customer-count port that count every data-access call. It asserts:
 *   1. The number of data-access round-trips is CONSTANT across 1000 vs 2000
 *      referrals (no per-referral ledger reads, no per-referral count calls).
 *   2. End-to-end assembly latency stays within a documented budget.
 *
 * It runs without a live database so it is a durable CI regression guard. The
 * bounded-query assertion is the load-bearing guarantee; the latency budget is a
 * generous local ceiling (assembly only, excludes real network/DB I/O).
 */
/* Instrumented mocks mirror the async repo/port signatures (no real awaits). */
/* eslint-disable @typescript-eslint/require-await */
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
import { InMemoryDashboardCacheAdapter } from '../../database/dashboard-cache.adapter';
import { ReferralVendorStatus } from '../../domain/vendor-referral.types';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const vendorId = BigInt(1);

// Dashboard caps the referral list at 50 rows (page size). The aggregate +
// batched-count design must remain O(1) in query count regardless of how many
// total referrals exist.
const DASHBOARD_PAGE = 50;
const LATENCY_BUDGET_MS = 250;

interface Counters {
  listVendorReferrals: number;
  earnedBreakdownByReferral: number;
  activeCustomerCountByVendor: number;
  activeCustomerCount: number;
  listCreditTransactions: number;
  otherReads: number;
}

function buildScenario(totalReferrals: number): {
  qry: GetDashboardQuery;
  counters: Counters;
} {
  const counters: Counters = {
    listVendorReferrals: 0,
    earnedBreakdownByReferral: 0,
    activeCustomerCountByVendor: 0,
    activeCustomerCount: 0,
    listCreditTransactions: 0,
    otherReads: 0,
  };

  // Only the first page is ever returned to the dashboard.
  const pageRows: VendorReferralRow[] = Array.from({ length: DASHBOARD_PAGE }, (_, i) => {
    const id = BigInt(i + 1);
    return {
      id,
      referrerVendorId: vendorId,
      refereeVendorId: BigInt(i + 1_000_000),
      referralCode: 'CODE',
      status: ReferralVendorStatus.SIGNED_UP,
      rewardType: null,
      rewardAmount: null,
      refereeName: `Referee ${id.toString()}`,
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
    };
  });

  const earned = new Map<bigint, ReferralEarnedBreakdown>(
    pageRows.map((r) => [
      r.id,
      { signup: 500, milestone10: 1000, milestone50: 0, revenueShare: 50 },
    ])
  );

  const repo = {
    getVendorReferralCode: jest.fn(async () => {
      counters.otherReads++;
      return 'EXISTING';
    }),
    getVendorCreditBalance: jest.fn(async () => {
      counters.otherReads++;
      return {
        id: BigInt(1),
        vendorId,
        availableCredits: 99999,
        lifetimeCreditsEarned: 99999,
        lifetimeCreditsUsed: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
    listVendorReferrals: jest.fn(async () => {
      counters.listVendorReferrals++;
      return { rows: pageRows, total: totalReferrals };
    }),
    earnedBreakdownByReferral: jest.fn(async () => {
      counters.earnedBreakdownByReferral++;
      return earned;
    }),
    findCustomerReferralSummary: jest.fn(async () => {
      counters.otherReads++;
      return {
        newThisMonth: 3,
        totalFromReferrals: totalReferrals,
        totalCustomers: totalReferrals,
      };
    }),
    findTopReferrers: jest.fn(async () => {
      counters.otherReads++;
      return [{ customerId: BigInt(1), customerName: 'Top', referralCount: 9 }];
    }),
    // These MUST never be called by the dashboard (they were the N+1 source).
    listCreditTransactions: jest.fn(async () => {
      counters.listCreditTransactions++;
      return { rows: [], total: 0 };
    }),
  } as unknown as IReferralRepository;

  const counts = {
    activeCustomerCountByVendor: jest.fn(async (ids: bigint[]) => {
      counters.activeCustomerCountByVendor++;
      return new Map(ids.map((id) => [id, 11]));
    }),
    activeCustomerCount: jest.fn(async () => {
      counters.activeCustomerCount++;
      return 11;
    }),
    customersAddedWithinDays: jest.fn(async () => 0),
  } as unknown as ICustomerCountPort;

  // Fresh cache per scenario so we measure a cold build, not a cache hit.
  const cache = new InMemoryDashboardCacheAdapter<DashboardResult>();
  const qry = new GetDashboardQuery(repo, counts, cache, logger);
  return { qry, counters };
}

function totalDbCalls(c: Counters): number {
  return (
    c.listVendorReferrals +
    c.earnedBreakdownByReferral +
    c.activeCustomerCountByVendor +
    c.activeCustomerCount +
    c.listCreditTransactions +
    c.otherReads
  );
}

describe('GetDashboardQuery — performance & no-N+1 regression guard', () => {
  it('issues a CONSTANT number of data-access calls for 1000 vs 2000 referrals', async () => {
    const a = buildScenario(1000);
    await a.qry.execute(vendorId);

    const b = buildScenario(2000);
    await b.qry.execute(vendorId);

    // The total round-trip count must not grow with referral count.
    expect(totalDbCalls(a.counters)).toBe(totalDbCalls(b.counters));

    // And specifically: the former N+1 sources are each called at most once.
    expect(a.counters.earnedBreakdownByReferral).toBe(1);
    expect(a.counters.activeCustomerCountByVendor).toBe(1);
    expect(a.counters.listCreditTransactions).toBe(0);
    expect(a.counters.activeCustomerCount).toBe(0);
  });

  it('does not call any per-referral ledger or per-referral count query', async () => {
    const { qry, counters } = buildScenario(1500);
    await qry.execute(vendorId);

    expect(counters.listCreditTransactions).toBe(0);
    expect(counters.activeCustomerCount).toBe(0);
  });

  it('assembles a 1000+ referral dashboard within the latency budget', async () => {
    const { qry } = buildScenario(2000);

    const start = performance.now();
    const result = await qry.execute(vendorId);
    const elapsed = performance.now() - start;

    expect(result.vendorReferrals).toHaveLength(DASHBOARD_PAGE);
    expect(elapsed).toBeLessThan(LATENCY_BUDGET_MS);
  });
});
