/**
 * VendorSubscriptionEntity unit tests — state machine, invariants, events.
 */
import { VendorSubscriptionEntity } from '../../domain/subscription.entity';
import { SubscriptionPlanEntity } from '../../domain/plan.entity';
import { PlanTierVO, PlanTierEnum } from '../../domain/value-objects/plan-tier.vo';
import { PlanLimitsVO } from '../../domain/value-objects/plan-limits.vo';
import { VendorSubscriptionStatus, BillingCycleEnum } from '../../domain/subscription.types';
import {
  InvalidPlanUpgradeError,
  SubscriptionAlreadyCancelledError,
} from '../../domain/subscription.errors';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeStarterPlan(): SubscriptionPlanEntity {
  return SubscriptionPlanEntity.fromPersistence({
    id: 1n,
    planCode: 'STARTER',
    planName: 'Starter',
    priceMonthly: 0,
    priceYearly: 0,
    maxCustomers: 50,
    maxStaff: 2,
    maxSupplyLists: 3,
    features: null,
    isActive: true,
  });
}

function makeGrowthPlan(): SubscriptionPlanEntity {
  return SubscriptionPlanEntity.fromPersistence({
    id: 2n,
    planCode: 'GROWTH',
    planName: 'Growth',
    priceMonthly: 499,
    priceYearly: 4999,
    maxCustomers: 200,
    maxStaff: 10,
    maxSupplyLists: 15,
    features: null,
    isActive: true,
  });
}

function makeProPlan(): SubscriptionPlanEntity {
  return SubscriptionPlanEntity.fromPersistence({
    id: 3n,
    planCode: 'PRO',
    planName: 'Pro',
    priceMonthly: 999,
    priceYearly: 9999,
    maxCustomers: 0,
    maxStaff: 0,
    maxSupplyLists: 0,
    features: null,
    isActive: true,
  });
}

const TODAY = new Date('2026-01-01T00:00:00Z');
const VENDOR_ID = 42n;

// ── createStarter factory ─────────────────────────────────────────────────────

describe('VendorSubscriptionEntity.createStarter', () => {
  it('creates entity with ACTIVE status and MONTHLY billing', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);

    expect(entity.status).toBe(VendorSubscriptionStatus.ACTIVE);
    expect(entity.billingCycle.value).toBe(BillingCycleEnum.MONTHLY);
    expect(entity.vendorId).toBe(VENDOR_ID);
    expect(entity.subscriptionPlanId).toBe(plan.id);
    expect(entity.amountPaid.amount).toBe(0);
    expect(entity.autoRenewal).toBe(true);
    expect(entity.isTrial).toBe(false);
  });

  it('sets nextBillingDate to today + 30 days', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);

    const expected = new Date(TODAY);
    expected.setDate(expected.getDate() + 30);
    expect(entity.nextBillingDate?.toISOString()).toBe(expected.toISOString());
  });

  it('emits SubscriptionCreatedEvent', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    const events = entity.pullEvents();

    expect(events).toHaveLength(1);
    expect(events[0]?.constructor.name).toBe('SubscriptionCreatedEvent');
  });

  it('pullEvents clears the events queue', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.pullEvents(); // drain
    expect(entity.pullEvents()).toHaveLength(0);
  });
});

// ── closeForUpgrade ───────────────────────────────────────────────────────────

describe('VendorSubscriptionEntity.closeForUpgrade', () => {
  it('sets status to CANCELLED and endDate to today', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.assignId(10n);

    const closed = entity.closeForUpgrade(TODAY);
    expect(closed.status).toBe(VendorSubscriptionStatus.CANCELLED);
    expect(closed.endDate?.toISOString()).toBe(TODAY.toISOString());
  });
});

// ── upgradeTo ─────────────────────────────────────────────────────────────────

describe('VendorSubscriptionEntity.upgradeTo', () => {
  it('creates new entity with higher-tier plan', () => {
    const starter = makeStarterPlan();
    const growth = makeGrowthPlan();
    const currentEntity = VendorSubscriptionEntity.createStarter(VENDOR_ID, starter, TODAY);
    currentEntity.assignId(10n);

    const newEntity = VendorSubscriptionEntity.upgradeTo(
      currentEntity,
      growth,
      PlanTierVO.fromCode('STARTER'),
      BillingCycleEnum.MONTHLY,
      TODAY,
      100,
      1n
    );

    expect(newEntity.status).toBe(VendorSubscriptionStatus.ACTIVE);
    expect(newEntity.subscriptionPlanId).toBe(growth.id);
    expect(newEntity.amountPaid.amount).toBe(100);
  });

  it('emits SubscriptionUpgradedEvent', () => {
    const starter = makeStarterPlan();
    const growth = makeGrowthPlan();
    const currentEntity = VendorSubscriptionEntity.createStarter(VENDOR_ID, starter, TODAY);
    currentEntity.assignId(10n);
    currentEntity.pullEvents(); // drain creation events

    const newEntity = VendorSubscriptionEntity.upgradeTo(
      currentEntity,
      growth,
      PlanTierVO.fromCode('STARTER'),
      BillingCycleEnum.MONTHLY,
      TODAY,
      0,
      1n
    );

    const events = newEntity.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.constructor.name).toBe('SubscriptionUpgradedEvent');
  });

  it('throws InvalidPlanUpgradeError when target tier is not higher', () => {
    const growth = makeGrowthPlan();
    const starter = makeStarterPlan();
    const currentEntity = VendorSubscriptionEntity.createStarter(VENDOR_ID, growth, TODAY);
    currentEntity.assignId(10n);

    expect(() =>
      VendorSubscriptionEntity.upgradeTo(
        currentEntity,
        starter,
        PlanTierVO.fromCode('GROWTH'), // current tier
        BillingCycleEnum.MONTHLY,
        TODAY,
        0
      )
    ).toThrow(InvalidPlanUpgradeError);
  });

  it('throws InvalidPlanUpgradeError when upgrading to same tier', () => {
    const starter = makeStarterPlan();
    const anotherStarter = makeStarterPlan();
    const currentEntity = VendorSubscriptionEntity.createStarter(VENDOR_ID, starter, TODAY);
    currentEntity.assignId(10n);

    expect(() =>
      VendorSubscriptionEntity.upgradeTo(
        currentEntity,
        anotherStarter,
        PlanTierVO.fromCode('STARTER'),
        BillingCycleEnum.MONTHLY,
        TODAY,
        0
      )
    ).toThrow(InvalidPlanUpgradeError);
  });
});

// ── cancel ────────────────────────────────────────────────────────────────────

describe('VendorSubscriptionEntity.cancel', () => {
  it('cancels an ACTIVE subscription', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.assignId(10n);

    entity.cancel(TODAY, 1n);
    expect(entity.status).toBe(VendorSubscriptionStatus.CANCELLED);
    expect(entity.autoRenewal).toBe(false);
  });

  it('emits SubscriptionCancelledEvent', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.assignId(10n);
    entity.pullEvents(); // drain creation

    entity.cancel(TODAY, 1n);
    const events = entity.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.constructor.name).toBe('SubscriptionCancelledEvent');
  });

  it('throws SubscriptionAlreadyCancelledError if already cancelled', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.assignId(10n);
    entity.cancel(TODAY, 1n);

    expect(() => entity.cancel(TODAY, 1n)).toThrow(SubscriptionAlreadyCancelledError);
  });
});

// ── expire ────────────────────────────────────────────────────────────────────

describe('VendorSubscriptionEntity.expire', () => {
  it('sets status to EXPIRED', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.assignId(10n);

    entity.expire(TODAY);
    expect(entity.status).toBe(VendorSubscriptionStatus.EXPIRED);
  });

  it('is idempotent when already EXPIRED', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.assignId(10n);

    entity.expire(TODAY);
    entity.expire(TODAY); // second call should not throw
    expect(entity.status).toBe(VendorSubscriptionStatus.EXPIRED);
  });

  it('emits SubscriptionExpiredEvent (only once)', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.assignId(10n);
    entity.pullEvents(); // drain creation

    entity.expire(TODAY);
    entity.expire(TODAY); // second call → idempotent
    const events = entity.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.constructor.name).toBe('SubscriptionExpiredEvent');
  });
});

// ── renew ─────────────────────────────────────────────────────────────────────

describe('VendorSubscriptionEntity.renew', () => {
  it('extends subscription and emits RenewedEvent', () => {
    const plan = makeGrowthPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    entity.assignId(10n);
    entity.pullEvents(); // drain

    entity.renew(BillingCycleEnum.MONTHLY, TODAY, 499, 1n);

    expect(entity.status).toBe(VendorSubscriptionStatus.ACTIVE);
    expect(entity.amountPaid.amount).toBe(499);

    const events = entity.pullEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.constructor.name).toBe('SubscriptionRenewedEvent');
  });
});

// ── setAutoRenewal ────────────────────────────────────────────────────────────

describe('VendorSubscriptionEntity.setAutoRenewal', () => {
  it('toggles autoRenewal flag', () => {
    const plan = makeStarterPlan();
    const entity = VendorSubscriptionEntity.createStarter(VENDOR_ID, plan, TODAY);
    expect(entity.autoRenewal).toBe(true);

    entity.setAutoRenewal(false);
    expect(entity.autoRenewal).toBe(false);

    entity.setAutoRenewal(true);
    expect(entity.autoRenewal).toBe(true);
  });
});

// ── SubscriptionPlanEntity ────────────────────────────────────────────────────

describe('SubscriptionPlanEntity', () => {
  it('tier is derived from planCode', () => {
    const plan = makeProPlan();
    expect(plan.tier.value).toBe(PlanTierEnum.PRO);
  });

  it('limits are derived from max fields', () => {
    const plan = makeGrowthPlan();
    const limits: PlanLimitsVO = plan.limits;
    expect(limits.max('customers')).toBe(200);
    expect(limits.max('staff')).toBe(10);
    expect(limits.max('supplyLists')).toBe(15);
  });

  it('priceForCycle returns monthlyPrice for 30 days', () => {
    const plan = makeGrowthPlan();
    expect(plan.priceForCycle(30)).toBe(499);
  });

  it('priceForCycle returns yearlyPrice for 365 days', () => {
    const plan = makeGrowthPlan();
    expect(plan.priceForCycle(365)).toBe(4999);
  });

  it('priceForCycle returns monthlyPrice for non-365 cycles', () => {
    const plan = makeGrowthPlan();
    expect(plan.priceForCycle(90)).toBe(499);
  });
});
