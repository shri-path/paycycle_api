/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/**
 * Unit tests for UpgradeSubscriptionCommand.
 * Verifies: pro-rata calculation, invoice creation, port isolation.
 */
import { UpgradeSubscriptionCommand } from '../../commands/upgrade-subscription/upgrade-subscription.command';
import {
  ISubscriptionRepository,
  VendorSubscriptionRow,
  InvoiceRow,
} from '../../database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { SubscriptionPlanEntity } from '../../domain/plan.entity';
import { IPaymentGateway } from '../../services/payment/payment-gateway.port';
import { Logger } from '@/infrastructure/logger/logger';
import {
  BillingCycleEnum,
  VendorSubscriptionStatus,
  InvoicePaymentStatus,
} from '../../domain/subscription.types';
import {
  SubscriptionNotFoundError,
  PlanNotFoundError,
  InvalidPlanUpgradeError,
} from '../../domain/subscription.errors';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlan(
  id: bigint,
  code: string,
  priceMonthly: number,
  priceYearly: number,
  maxCustomers = 50
): SubscriptionPlanEntity {
  return SubscriptionPlanEntity.fromPersistence({
    id,
    planCode: code,
    planName: code,
    priceMonthly,
    priceYearly,
    maxCustomers,
    maxStaff: 5,
    maxSupplyLists: 5,
    features: null,
    isActive: true,
  });
}

function makeActiveRow(overrides: Partial<VendorSubscriptionRow> = {}): VendorSubscriptionRow {
  const today = new Date('2026-01-01T00:00:00Z');
  const nextBilling = new Date(today);
  nextBilling.setDate(nextBilling.getDate() + 30);
  return {
    id: 1n,
    vendorId: 42n,
    subscriptionPlanId: 1n,
    billingCycle: BillingCycleEnum.MONTHLY,
    startDate: today,
    endDate: null,
    nextBillingDate: nextBilling,
    status: VendorSubscriptionStatus.ACTIVE,
    amountPaid: 0,
    autoRenewal: true,
    isTrial: false,
    trialEndsAt: null,
    createdAt: today,
    updatedAt: today,
    ...overrides,
  };
}

function makeInvoiceRow(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  const today = new Date('2026-01-01T00:00:00Z');
  return {
    id: 100n,
    vendorSubscriptionId: 10n,
    vendorId: 42n,
    invoiceNumber: 'INV-2026-01-001',
    amount: 333,
    tax: 0,
    totalAmount: 333,
    invoiceDate: today,
    dueDate: new Date(today.getTime() + 5 * 86400000),
    paymentStatus: InvoicePaymentStatus.PENDING,
    paymentDate: null,
    paymentMethod: null,
    paymentReference: null,
    createdAt: today,
    ...overrides,
  };
}

function makeNewRow(overrides: Partial<VendorSubscriptionRow> = {}): VendorSubscriptionRow {
  const today = new Date('2026-01-01T00:00:00Z');
  return {
    id: 10n,
    vendorId: 42n,
    subscriptionPlanId: 2n,
    billingCycle: BillingCycleEnum.MONTHLY,
    startDate: today,
    endDate: null,
    nextBillingDate: new Date(today.getTime() + 30 * 86400000),
    status: VendorSubscriptionStatus.ACTIVE,
    amountPaid: 333,
    autoRenewal: true,
    isTrial: false,
    trialEndsAt: null,
    createdAt: today,
    updatedAt: today,
    ...overrides,
  };
}

// ── Mock factory ──────────────────────────────────────────────────────────────

function buildMocks() {
  const starterPlan = makePlan(1n, 'STARTER', 0, 0, 50);
  const growthPlan = makePlan(2n, 'GROWTH', 499, 4999, 200);
  const today = new Date('2026-01-01T00:00:00Z');
  const activeRow = makeActiveRow({ subscriptionPlanId: 1n });
  const newRow = makeNewRow({ subscriptionPlanId: 2n, amountPaid: 333 });
  const invoiceRow = makeInvoiceRow({ amount: 333, totalAmount: 333 });

  const mockTx = {} as unknown as PrismaTransaction;

  const subscriptionRepo: jest.Mocked<ISubscriptionRepository> = {
    findActiveByVendor: jest.fn().mockResolvedValue(activeRow),
    findLatestExpiredByVendor: jest.fn().mockResolvedValue(null),
    findDueSubscriptions: jest.fn().mockResolvedValue([]),
    closeAndOpen: jest.fn().mockResolvedValue({ old: activeRow, new: newRow }),
    persist: jest.fn().mockResolvedValue(newRow),
    appendHistory: jest.fn().mockResolvedValue(undefined),
    insertInvoice: jest.fn().mockResolvedValue(invoiceRow),
    listInvoices: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    listHistory: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    generateInvoiceNumber: jest.fn().mockResolvedValue('INV-2026-01-001'),
    transaction: jest
      .fn()
      .mockImplementation((fn: (tx: PrismaTransaction) => Promise<unknown>) => fn(mockTx)),
  };

  const planRepo: jest.Mocked<ISubscriptionPlanRepository> = {
    findAllActive: jest.fn().mockResolvedValue([starterPlan, growthPlan]),
    findActiveById: jest.fn().mockImplementation((id: bigint) => {
      if (id === 1n) return Promise.resolve(starterPlan);
      if (id === 2n) return Promise.resolve(growthPlan);
      return Promise.resolve(null);
    }),
    findByCode: jest.fn().mockResolvedValue(null),
  };

  const paymentGateway: jest.Mocked<IPaymentGateway> = {
    createCheckout: jest.fn().mockResolvedValue({ paymentUrl: 'https://pay.example.com/checkout' }),
  };

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(),
  } as unknown as Logger;

  return {
    subscriptionRepo,
    planRepo,
    paymentGateway,
    mockLogger,
    today,
    activeRow,
    newRow,
    invoiceRow,
    starterPlan,
    growthPlan,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UpgradeSubscriptionCommand', () => {
  it('returns upgrade response with subscription and invoice', async () => {
    const { subscriptionRepo, planRepo, paymentGateway, mockLogger, today } = buildMocks();
    const cmd = new UpgradeSubscriptionCommand(
      subscriptionRepo,
      planRepo,
      paymentGateway,
      mockLogger
    );

    const result = await cmd.execute({
      vendorId: 42n,
      newPlanId: 2n,
      billingCycle: BillingCycleEnum.MONTHLY,
      performedByUserId: 1n,
      today,
    });

    expect(result.subscription.planId).toBe('2');
    expect(result.invoice.invoiceNumber).toBe('INV-2026-01-001');
    expect(subscriptionRepo.closeAndOpen).toHaveBeenCalledTimes(1);
    expect(subscriptionRepo.appendHistory).toHaveBeenCalledTimes(1);
    expect(subscriptionRepo.generateInvoiceNumber).toHaveBeenCalledTimes(1);
    expect(subscriptionRepo.insertInvoice).toHaveBeenCalledTimes(1);
  });

  it('throws SubscriptionNotFoundError when no active subscription', async () => {
    const { subscriptionRepo, planRepo, paymentGateway, mockLogger, today } = buildMocks();
    subscriptionRepo.findActiveByVendor.mockResolvedValue(null);
    const cmd = new UpgradeSubscriptionCommand(
      subscriptionRepo,
      planRepo,
      paymentGateway,
      mockLogger
    );

    await expect(
      cmd.execute({
        vendorId: 42n,
        newPlanId: 2n,
        billingCycle: BillingCycleEnum.MONTHLY,
        performedByUserId: 1n,
        today,
      })
    ).rejects.toThrow(SubscriptionNotFoundError);
  });

  it('throws PlanNotFoundError when target plan does not exist', async () => {
    const { subscriptionRepo, planRepo, paymentGateway, mockLogger, today } = buildMocks();
    planRepo.findActiveById.mockImplementation((id: bigint) => {
      if (id === 1n) return Promise.resolve(makePlan(1n, 'STARTER', 0, 0, 50));
      return Promise.resolve(null);
    });
    const cmd = new UpgradeSubscriptionCommand(
      subscriptionRepo,
      planRepo,
      paymentGateway,
      mockLogger
    );

    await expect(
      cmd.execute({
        vendorId: 42n,
        newPlanId: 99n,
        billingCycle: BillingCycleEnum.MONTHLY,
        performedByUserId: 1n,
        today,
      })
    ).rejects.toThrow(PlanNotFoundError);
  });

  it('throws InvalidPlanUpgradeError when target plan is same or lower tier', async () => {
    const { subscriptionRepo, planRepo, paymentGateway, mockLogger, today } = buildMocks();
    // Active subscription is GROWTH, target is STARTER (lower)
    subscriptionRepo.findActiveByVendor.mockResolvedValue(
      makeActiveRow({ subscriptionPlanId: 2n })
    );
    planRepo.findActiveById.mockImplementation((id: bigint) => {
      if (id === 2n) return Promise.resolve(makePlan(2n, 'GROWTH', 499, 4999, 200));
      if (id === 1n) return Promise.resolve(makePlan(1n, 'STARTER', 0, 0, 50));
      return Promise.resolve(null);
    });
    const cmd = new UpgradeSubscriptionCommand(
      subscriptionRepo,
      planRepo,
      paymentGateway,
      mockLogger
    );

    await expect(
      cmd.execute({
        vendorId: 42n,
        newPlanId: 1n,
        billingCycle: BillingCycleEnum.MONTHLY,
        performedByUserId: 1n,
        today,
      })
    ).rejects.toThrow(InvalidPlanUpgradeError);
  });

  it('sets invoice paymentStatus=PAID when pro-rata amount is 0 (Starter → Growth free upgrade)', async () => {
    const { subscriptionRepo, planRepo, paymentGateway, mockLogger, today } = buildMocks();
    // Force prorata = 0 by having no days remaining (nextBillingDate = today)
    subscriptionRepo.findActiveByVendor.mockResolvedValue(
      makeActiveRow({ nextBillingDate: today })
    );
    const cmd = new UpgradeSubscriptionCommand(
      subscriptionRepo,
      planRepo,
      paymentGateway,
      mockLogger
    );

    await cmd.execute({
      vendorId: 42n,
      newPlanId: 2n,
      billingCycle: BillingCycleEnum.MONTHLY,
      performedByUserId: 1n,
      today,
    });

    const insertCall = (subscriptionRepo.insertInvoice as jest.Mock).mock.calls[0][0];
    // When prorata is 0 (Starter plan has priceMonthly=0) → PAID
    expect(insertCall.paymentStatus).toBe(InvoicePaymentStatus.PAID);
  });

  it('does NOT call generateInvoiceNumber as a static on SubscriptionRepository (uses port)', async () => {
    const { subscriptionRepo, planRepo, paymentGateway, mockLogger, today } = buildMocks();
    const cmd = new UpgradeSubscriptionCommand(
      subscriptionRepo,
      planRepo,
      paymentGateway,
      mockLogger
    );

    await cmd.execute({
      vendorId: 42n,
      newPlanId: 2n,
      billingCycle: BillingCycleEnum.MONTHLY,
      performedByUserId: 1n,
      today,
    });

    // The instance method on the port must be called, not a static
    expect(subscriptionRepo.generateInvoiceNumber).toHaveBeenCalledWith(
      42n,
      today,
      expect.anything()
    );
  });
});
