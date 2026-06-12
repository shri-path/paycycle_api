/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Unit tests for enforceSubscriptionLimit middleware.
 * Verifies: at-limit → 451, below-limit → next(), unlimited (0) → next(),
 * no-subscription → next() (fail-open), no roleContext → next() (fail-open).
 */
import { Request, Response, NextFunction } from 'express';
import { enforceSubscriptionLimit } from '@/infrastructure/middlewares/subscription/enforce-subscription-limit';
import {
  ISubscriptionRepository,
  VendorSubscriptionRow,
} from '../../database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { IUsageCounter } from '../../ports/usage-counter.port';
import { SubscriptionPlanEntity } from '../../domain/plan.entity';
import { SubscriptionLimitReachedError } from '../../domain/subscription.errors';
import { BillingCycleEnum, VendorSubscriptionStatus } from '../../domain/subscription.types';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-01-01T00:00:00Z');
const VENDOR_ID = 42n;

function makePlan(maxCustomers: number, maxStaff = 5, maxSupplyLists = 5): SubscriptionPlanEntity {
  return SubscriptionPlanEntity.fromPersistence({
    id: 1n,
    planCode: 'STARTER',
    planName: 'Starter',
    priceMonthly: 0,
    priceYearly: 0,
    maxCustomers,
    maxStaff,
    maxSupplyLists,
    features: null,
    isActive: true,
  });
}

function makeSubRow(overrides: Partial<VendorSubscriptionRow> = {}): VendorSubscriptionRow {
  return {
    id: 1n,
    vendorId: VENDOR_ID,
    subscriptionPlanId: 1n,
    billingCycle: BillingCycleEnum.MONTHLY,
    startDate: TODAY,
    endDate: null,
    nextBillingDate: new Date(TODAY.getTime() + 30 * 86400000),
    status: VendorSubscriptionStatus.ACTIVE,
    amountPaid: 0,
    autoRenewal: true,
    isTrial: false,
    trialEndsAt: null,
    createdAt: TODAY,
    updatedAt: TODAY,
    ...overrides,
  };
}

function makeRepoMock(row: VendorSubscriptionRow | null): jest.Mocked<ISubscriptionRepository> {
  const mockTx = {} as unknown as PrismaTransaction;
  return {
    findActiveByVendor: jest.fn().mockResolvedValue(row),
    findLatestExpiredByVendor: jest.fn().mockResolvedValue(null),
    findDueSubscriptions: jest.fn().mockResolvedValue([]),
    closeAndOpen: jest.fn(),
    persist: jest.fn(),
    appendHistory: jest.fn(),
    insertInvoice: jest.fn(),
    listInvoices: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    listHistory: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    generateInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-01-001'),
    transaction: jest
      .fn()
      .mockImplementation((fn: (tx: PrismaTransaction) => Promise<unknown>) => fn(mockTx)),
  };
}

function makePlanRepoMock(
  plan: SubscriptionPlanEntity | null
): jest.Mocked<ISubscriptionPlanRepository> {
  return {
    findAllActive: jest.fn().mockResolvedValue(plan ? [plan] : []),
    findActiveById: jest.fn().mockResolvedValue(plan),
    findByCode: jest.fn().mockResolvedValue(plan),
  };
}

function makeUsageCounterMock(
  counts: { customers?: number; staff?: number; supplyLists?: number } = {}
): jest.Mocked<IUsageCounter> {
  return {
    countCustomers: jest.fn().mockResolvedValue(counts.customers ?? 0),
    countStaff: jest.fn().mockResolvedValue(counts.staff ?? 0),
    countSupplyLists: jest.fn().mockResolvedValue(counts.supplyLists ?? 0),
    countAll: jest.fn().mockResolvedValue({ customers: 0, staff: 0, supplyLists: 0 }),
  };
}

function makeReq(vendorId: bigint | null = VENDOR_ID): Partial<Request> {
  return {
    headers: {},
    roleContext: vendorId != null ? { vendorId, role: 'OWNER', permissions: [] } : undefined,
  };
}

function runMiddleware(
  middleware: ReturnType<typeof enforceSubscriptionLimit>,
  req: Partial<Request>
): Promise<unknown> {
  return new Promise((resolve) => {
    const next: NextFunction = (err?: unknown) => resolve(err);
    middleware(req as Request, {} as Response, next);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('enforceSubscriptionLimit middleware', () => {
  it('calls next() with no error when count is below the limit', async () => {
    const repo = makeRepoMock(makeSubRow());
    const planRepo = makePlanRepoMock(makePlan(50)); // max 50 customers
    const counter = makeUsageCounterMock({ customers: 49 });
    const middleware = enforceSubscriptionLimit('customers', repo, planRepo, counter);

    const err = await runMiddleware(middleware, makeReq());
    expect(err).toBeUndefined();
  });

  it('calls next(SubscriptionLimitReachedError) when count equals limit', async () => {
    const repo = makeRepoMock(makeSubRow());
    const planRepo = makePlanRepoMock(makePlan(50));
    const counter = makeUsageCounterMock({ customers: 50 }); // at limit
    const middleware = enforceSubscriptionLimit('customers', repo, planRepo, counter);

    const err = await runMiddleware(middleware, makeReq());
    expect(err).toBeInstanceOf(SubscriptionLimitReachedError);
    expect((err as SubscriptionLimitReachedError).statusCode).toBe(451);
  });

  it('calls next(SubscriptionLimitReachedError) when count exceeds limit', async () => {
    const repo = makeRepoMock(makeSubRow());
    const planRepo = makePlanRepoMock(makePlan(50));
    const counter = makeUsageCounterMock({ customers: 55 }); // over limit
    const middleware = enforceSubscriptionLimit('customers', repo, planRepo, counter);

    const err = await runMiddleware(middleware, makeReq());
    expect(err).toBeInstanceOf(SubscriptionLimitReachedError);
  });

  it('calls next() with no error when plan limit is 0 (unlimited)', async () => {
    const repo = makeRepoMock(makeSubRow());
    const planRepo = makePlanRepoMock(makePlan(0)); // 0 = unlimited
    const counter = makeUsageCounterMock({ customers: 9999 });
    const middleware = enforceSubscriptionLimit('customers', repo, planRepo, counter);

    const err = await runMiddleware(middleware, makeReq());
    expect(err).toBeUndefined();
    // Should not even call the counter when unlimited
    expect(counter.countCustomers).not.toHaveBeenCalled();
  });

  it('calls next() with no error (fail-open) when no active subscription found', async () => {
    const repo = makeRepoMock(null); // no subscription
    const planRepo = makePlanRepoMock(makePlan(50));
    const counter = makeUsageCounterMock({ customers: 100 });
    const middleware = enforceSubscriptionLimit('customers', repo, planRepo, counter);

    const err = await runMiddleware(middleware, makeReq());
    expect(err).toBeUndefined();
  });

  it('calls next() with no error (fail-open) when no roleContext on request', async () => {
    const repo = makeRepoMock(makeSubRow());
    const planRepo = makePlanRepoMock(makePlan(50));
    const counter = makeUsageCounterMock({ customers: 50 });
    const middleware = enforceSubscriptionLimit('customers', repo, planRepo, counter);

    const err = await runMiddleware(middleware, makeReq(null));
    expect(err).toBeUndefined();
  });

  it('checks staff resource correctly', async () => {
    const repo = makeRepoMock(makeSubRow());
    const planRepo = makePlanRepoMock(makePlan(50, 5, 5)); // maxStaff=5
    const counter = makeUsageCounterMock({ staff: 5 }); // at staff limit
    const middleware = enforceSubscriptionLimit('staff', repo, planRepo, counter);

    const err = await runMiddleware(middleware, makeReq());
    expect(err).toBeInstanceOf(SubscriptionLimitReachedError);
    expect(counter.countStaff).toHaveBeenCalledWith(VENDOR_ID);
  });

  it('checks supplyLists resource correctly', async () => {
    const repo = makeRepoMock(makeSubRow());
    const planRepo = makePlanRepoMock(makePlan(50, 5, 3)); // maxSupplyLists=3
    const counter = makeUsageCounterMock({ supplyLists: 2 }); // below limit
    const middleware = enforceSubscriptionLimit('supplyLists', repo, planRepo, counter);

    const err = await runMiddleware(middleware, makeReq());
    expect(err).toBeUndefined();
    expect(counter.countSupplyLists).toHaveBeenCalledWith(VENDOR_ID);
  });

  it('includes correct limits details in the 451 error', async () => {
    const repo = makeRepoMock(makeSubRow());
    const planRepo = makePlanRepoMock(makePlan(50));
    const counter = makeUsageCounterMock({ customers: 50 });
    const middleware = enforceSubscriptionLimit('customers', repo, planRepo, counter);

    const err = (await runMiddleware(middleware, makeReq())) as SubscriptionLimitReachedError;
    const details = err.details as { upgradeUrl: string; limits: { max: number; current: number } };
    expect(details.limits.max).toBe(50);
    expect(details.limits.current).toBe(50);
    expect(details.upgradeUrl).toBeDefined();
  });
});
