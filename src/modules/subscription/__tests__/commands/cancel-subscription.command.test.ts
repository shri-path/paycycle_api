/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Unit tests for CancelSubscriptionCommand.
 * Verifies: state after cancel, history append, error on double-cancel.
 */
import { CancelSubscriptionCommand } from '../../commands/cancel-subscription/cancel-subscription.command';
import {
  ISubscriptionRepository,
  VendorSubscriptionRow,
} from '../../database/subscription.repository.port';
import { Logger } from '@/infrastructure/logger/logger';
import { BillingCycleEnum, VendorSubscriptionStatus } from '../../domain/subscription.types';
import { SubscriptionNotFoundError } from '../../domain/subscription.errors';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TODAY = new Date('2026-01-01T00:00:00Z');
const NEXT_BILLING = new Date('2026-01-31T00:00:00Z');

function makeActiveRow(overrides: Partial<VendorSubscriptionRow> = {}): VendorSubscriptionRow {
  return {
    id: 1n,
    vendorId: 42n,
    subscriptionPlanId: 1n,
    billingCycle: BillingCycleEnum.MONTHLY,
    startDate: TODAY,
    endDate: null,
    nextBillingDate: NEXT_BILLING,
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

function buildMocks(activeRow: VendorSubscriptionRow | null = makeActiveRow()) {
  const mockTx = {} as unknown as PrismaTransaction;

  const subscriptionRepo: jest.Mocked<ISubscriptionRepository> = {
    findActiveByVendor: jest.fn().mockResolvedValue(activeRow),
    findLatestExpiredByVendor: jest.fn().mockResolvedValue(null),
    findDueSubscriptions: jest.fn().mockResolvedValue([]),
    closeAndOpen: jest.fn(),
    persist: jest.fn().mockResolvedValue({
      ...makeActiveRow(),
      status: VendorSubscriptionStatus.CANCELLED,
      autoRenewal: false,
    }),
    appendHistory: jest.fn().mockResolvedValue(undefined),
    insertInvoice: jest.fn(),
    listInvoices: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    listHistory: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    generateInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-01-001'),
    transaction: jest
      .fn()
      .mockImplementation((fn: (tx: PrismaTransaction) => Promise<unknown>) => fn(mockTx)),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(),
  } as unknown as Logger;

  return { subscriptionRepo, mockLogger };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CancelSubscriptionCommand', () => {
  it('cancels an ACTIVE subscription and returns cancel DTO', async () => {
    const { subscriptionRepo, mockLogger } = buildMocks();

    // persist returns CANCELLED row
    subscriptionRepo.persist.mockResolvedValue({
      ...makeActiveRow(),
      status: VendorSubscriptionStatus.CANCELLED,
      autoRenewal: false,
    });

    const cmd = new CancelSubscriptionCommand(subscriptionRepo, mockLogger);
    const result = await cmd.execute({ vendorId: 42n, performedByUserId: 1n, today: TODAY });

    expect(result.status).toBe(VendorSubscriptionStatus.CANCELLED);
    expect(result.autoRenewal).toBe(false);
    expect(subscriptionRepo.appendHistory).toHaveBeenCalledTimes(1);
  });

  it('returns the subscription ID in the response', async () => {
    const { subscriptionRepo, mockLogger } = buildMocks();
    subscriptionRepo.persist.mockResolvedValue({
      ...makeActiveRow(),
      id: 1n,
      status: VendorSubscriptionStatus.CANCELLED,
      autoRenewal: false,
    });

    const cmd = new CancelSubscriptionCommand(subscriptionRepo, mockLogger);
    const result = await cmd.execute({ vendorId: 42n, performedByUserId: 1n, today: TODAY });

    expect(result.subscriptionId).toBe('1');
  });

  it('throws SubscriptionNotFoundError when no active subscription exists', async () => {
    const { subscriptionRepo, mockLogger } = buildMocks(null);
    const cmd = new CancelSubscriptionCommand(subscriptionRepo, mockLogger);

    await expect(
      cmd.execute({ vendorId: 42n, performedByUserId: 1n, today: TODAY })
    ).rejects.toThrow(SubscriptionNotFoundError);
  });

  it('calls persist exactly once (no duplicate writes)', async () => {
    const { subscriptionRepo, mockLogger } = buildMocks();
    subscriptionRepo.persist.mockResolvedValue({
      ...makeActiveRow(),
      status: VendorSubscriptionStatus.CANCELLED,
      autoRenewal: false,
    });
    const cmd = new CancelSubscriptionCommand(subscriptionRepo, mockLogger);

    await cmd.execute({ vendorId: 42n, performedByUserId: 1n, today: TODAY });

    expect(subscriptionRepo.persist).toHaveBeenCalledTimes(1);
  });

  it('passes autoRenewal=false after cancellation', async () => {
    const { subscriptionRepo, mockLogger } = buildMocks(makeActiveRow({ autoRenewal: true }));
    subscriptionRepo.persist.mockResolvedValue({
      ...makeActiveRow(),
      status: VendorSubscriptionStatus.CANCELLED,
      autoRenewal: false,
    });
    const cmd = new CancelSubscriptionCommand(subscriptionRepo, mockLogger);
    const result = await cmd.execute({ vendorId: 42n, performedByUserId: 1n, today: TODAY });

    expect(result.autoRenewal).toBe(false);
  });
});
