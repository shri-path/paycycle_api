import { SupplyUnit } from '../../domain/value-objects/supply-unit.value-object';
import { SupplyFrequencyVO } from '../../domain/value-objects/supply-frequency.value-object';
import { Quantity } from '../../domain/value-objects/quantity.value-object';
import { RateMoney } from '../../domain/value-objects/rate-money.value-object';
import { TimeOfDay } from '../../domain/value-objects/time-of-day.value-object';
import { DateRange } from '../../domain/value-objects/date-range.value-object';
import { SubscriptionStatus } from '../../domain/value-objects/subscription-status.value-object';

describe('SupplyUnit', () => {
  it('normalizes case-insensitively', () => {
    expect(SupplyUnit.create('LTR').value).toBe('ltr');
    expect(SupplyUnit.create('  Kg ').value).toBe('kg');
  });
  it('rejects an unknown unit', () => {
    expect(() => SupplyUnit.create('barrels')).toThrow();
  });
});

describe('SupplyFrequencyVO', () => {
  it('DAILY carries no rules', () => {
    expect(SupplyFrequencyVO.create('DAILY').rules).toHaveLength(0);
  });
  it('WEEKLY requires at least one dayOfWeek in 1..7', () => {
    expect(() => SupplyFrequencyVO.create('WEEKLY', [])).toThrow();
    expect(() => SupplyFrequencyVO.create('WEEKLY', [{ dayOfWeek: 8 }])).toThrow();
    expect(SupplyFrequencyVO.create('WEEKLY', [{ dayOfWeek: 1 }]).rules).toHaveLength(1);
  });
  it('MONTHLY requires at least one dayOfMonth in 1..31', () => {
    expect(() => SupplyFrequencyVO.create('MONTHLY', [{ dayOfMonth: 32 }])).toThrow();
    expect(SupplyFrequencyVO.create('MONTHLY', [{ dayOfMonth: 15 }]).rules).toHaveLength(1);
  });
});

describe('Quantity / RateMoney', () => {
  it('rejects negatives', () => {
    expect(() => Quantity.create(-1)).toThrow();
    expect(() => RateMoney.create(-0.01)).toThrow();
  });
  it('allows zero rate (free item)', () => {
    expect(RateMoney.create(0).amount).toBe(0);
  });
  it('rounds to dp', () => {
    expect(Quantity.create(1.23456).value).toBe(1.235);
    expect(RateMoney.create(59.999).amount).toBe(60);
  });
});

describe('TimeOfDay', () => {
  it('parses and unpacks HH:mm', () => {
    expect(TimeOfDay.create('06:30').unpack()).toBe('06:30');
  });
  it('rejects out-of-range', () => {
    expect(() => TimeOfDay.create('24:00')).toThrow();
    expect(() => TimeOfDay.create('6:30')).toThrow();
  });
});

describe('DateRange', () => {
  it('rejects endDate before startDate', () => {
    expect(() => DateRange.create(new Date('2025-02-01'), new Date('2025-01-01'))).toThrow();
  });
  it('allows null endDate', () => {
    expect(DateRange.create(new Date('2025-01-01')).endDate).toBeNull();
  });
});

describe('SubscriptionStatus', () => {
  it('ACTIVE → PAUSED → ACTIVE allowed', () => {
    expect(() => SubscriptionStatus.create('ACTIVE').assertTransition('PAUSED')).not.toThrow();
    expect(() => SubscriptionStatus.create('PAUSED').assertTransition('ACTIVE')).not.toThrow();
  });
  it('ENDED is terminal', () => {
    expect(SubscriptionStatus.create('ENDED').isTerminal()).toBe(true);
    expect(() => SubscriptionStatus.create('ENDED').assertTransition('ACTIVE')).toThrow();
  });
  it('derives from persistence', () => {
    expect(SubscriptionStatus.fromPersistence(true, null).value).toBe('ACTIVE');
    expect(SubscriptionStatus.fromPersistence(false, null).value).toBe('PAUSED');
    expect(SubscriptionStatus.fromPersistence(false, new Date()).value).toBe('ENDED');
  });
});
