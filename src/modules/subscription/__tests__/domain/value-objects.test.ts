/**
 * Value Object unit tests for the Subscription domain.
 */
import { PlanTierVO, PlanTierEnum } from '../../domain/value-objects/plan-tier.vo';
import { BillingCycleVO } from '../../domain/value-objects/billing-cycle.vo';
import { PlanLimitsVO } from '../../domain/value-objects/plan-limits.vo';
import { MoneyVO } from '../../domain/value-objects/money.vo';
import { BillingCycleEnum } from '../../domain/subscription.types';
import { ArgumentInvalidException } from '@/common/errors/app-error';

// ── PlanTierVO ──────────────────────────────────────────────────────────────

describe('PlanTierVO', () => {
  describe('fromCode', () => {
    it('creates STARTER tier', () => {
      const vo = PlanTierVO.fromCode('STARTER');
      expect(vo.value).toBe(PlanTierEnum.STARTER);
      expect(vo.rank()).toBe(0);
    });

    it('creates GROWTH tier', () => {
      const vo = PlanTierVO.fromCode('GROWTH');
      expect(vo.value).toBe(PlanTierEnum.GROWTH);
      expect(vo.rank()).toBe(1);
    });

    it('creates PRO tier', () => {
      const vo = PlanTierVO.fromCode('PRO');
      expect(vo.value).toBe(PlanTierEnum.PRO);
      expect(vo.rank()).toBe(2);
    });

    it('is case-insensitive', () => {
      const vo = PlanTierVO.fromCode('starter');
      expect(vo.value).toBe(PlanTierEnum.STARTER);
    });

    it('throws ArgumentInvalidException for unknown code', () => {
      expect(() => PlanTierVO.fromCode('ENTERPRISE')).toThrow(ArgumentInvalidException);
    });
  });

  describe('isHigherThan', () => {
    it('PRO is higher than GROWTH', () => {
      const pro = PlanTierVO.fromCode('PRO');
      const growth = PlanTierVO.fromCode('GROWTH');
      expect(pro.isHigherThan(growth)).toBe(true);
    });

    it('GROWTH is higher than STARTER', () => {
      const growth = PlanTierVO.fromCode('GROWTH');
      const starter = PlanTierVO.fromCode('STARTER');
      expect(growth.isHigherThan(starter)).toBe(true);
    });

    it('STARTER is NOT higher than STARTER', () => {
      const a = PlanTierVO.fromCode('STARTER');
      const b = PlanTierVO.fromCode('STARTER');
      expect(a.isHigherThan(b)).toBe(false);
    });

    it('STARTER is NOT higher than PRO', () => {
      const starter = PlanTierVO.fromCode('STARTER');
      const pro = PlanTierVO.fromCode('PRO');
      expect(starter.isHigherThan(pro)).toBe(false);
    });
  });

  describe('equals', () => {
    it('same tier equals itself', () => {
      const a = PlanTierVO.of(PlanTierEnum.GROWTH);
      const b = PlanTierVO.of(PlanTierEnum.GROWTH);
      expect(a.equals(b)).toBe(true);
    });

    it('different tiers are not equal', () => {
      const a = PlanTierVO.of(PlanTierEnum.STARTER);
      const b = PlanTierVO.of(PlanTierEnum.PRO);
      expect(a.equals(b)).toBe(false);
    });
  });
});

// ── BillingCycleVO ──────────────────────────────────────────────────────────

describe('BillingCycleVO', () => {
  it('MONTHLY returns 30 days', () => {
    const vo = BillingCycleVO.of(BillingCycleEnum.MONTHLY);
    expect(vo.days()).toBe(30);
  });

  it('YEARLY returns 365 days', () => {
    const vo = BillingCycleVO.of(BillingCycleEnum.YEARLY);
    expect(vo.days()).toBe(365);
  });

  it('fromString is case-insensitive', () => {
    const vo = BillingCycleVO.fromString('yearly');
    expect(vo.days()).toBe(365);
  });

  it('fromString throws for invalid value', () => {
    expect(() => BillingCycleVO.fromString('WEEKLY')).toThrow(ArgumentInvalidException);
  });

  it('equals works structurally', () => {
    const a = BillingCycleVO.of(BillingCycleEnum.MONTHLY);
    const b = BillingCycleVO.of(BillingCycleEnum.MONTHLY);
    expect(a.equals(b)).toBe(true);
  });
});

// ── PlanLimitsVO ────────────────────────────────────────────────────────────

describe('PlanLimitsVO', () => {
  it('0 means unlimited for each resource', () => {
    const limits = PlanLimitsVO.create(0, 0, 0);
    expect(limits.isUnlimited('customers')).toBe(true);
    expect(limits.isUnlimited('staff')).toBe(true);
    expect(limits.isUnlimited('supplyLists')).toBe(true);
  });

  it('allows when count < max', () => {
    const limits = PlanLimitsVO.create(50, 5, 3);
    expect(limits.allows('customers', 49)).toBe(true);
    expect(limits.allows('staff', 4)).toBe(true);
    expect(limits.allows('supplyLists', 2)).toBe(true);
  });

  it('does NOT allow when count >= max', () => {
    const limits = PlanLimitsVO.create(50, 5, 3);
    expect(limits.allows('customers', 50)).toBe(false);
    expect(limits.allows('staff', 5)).toBe(false);
  });

  it('unlimited always allows', () => {
    const limits = PlanLimitsVO.create(0, 0, 0);
    expect(limits.allows('customers', 9999)).toBe(true);
  });

  it('max returns the configured maximum', () => {
    const limits = PlanLimitsVO.create(100, 10, 5);
    expect(limits.max('customers')).toBe(100);
    expect(limits.max('staff')).toBe(10);
    expect(limits.max('supplyLists')).toBe(5);
  });
});

// ── MoneyVO ─────────────────────────────────────────────────────────────────

describe('MoneyVO', () => {
  it('creates from valid number', () => {
    const m = MoneyVO.of(99.99);
    expect(m.amount).toBe(99.99);
  });

  it('rejects negative amount', () => {
    expect(() => MoneyVO.of(-1)).toThrow(ArgumentInvalidException);
  });

  it('rejects amount above max', () => {
    expect(() => MoneyVO.of(100_000_000)).toThrow(ArgumentInvalidException);
  });

  it('multiply scales amount', () => {
    const m = MoneyVO.of(10);
    expect(m.multiply(2).amount).toBe(20);
  });

  it('subtract floors at 0', () => {
    const m = MoneyVO.of(5);
    const result = m.subtract(MoneyVO.of(10));
    expect(result.amount).toBe(0);
  });

  it('subtract returns difference when positive', () => {
    const m = MoneyVO.of(100);
    const result = m.subtract(MoneyVO.of(30));
    expect(result.amount).toBe(70);
  });

  it('of rounds to 2 decimal places on construction', () => {
    // 10.555 → round to 2dp = 10.56 (Math.round(10.555*100)/100 = 10.56)
    const m = MoneyVO.of(10.554);
    expect(m.amount).toBe(10.55);
  });
});
