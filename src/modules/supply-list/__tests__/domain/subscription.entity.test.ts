import { SubscriptionEntity } from '../../domain/subscription.entity';
import { CreateSubscriptionProps, ListDefaults } from '../../domain/subscription.types';

function baseProps(overrides: Partial<CreateSubscriptionProps> = {}): CreateSubscriptionProps {
  return {
    vendorId: 1n,
    supplyListId: 2n,
    customerId: 3n,
    customQuantity: null,
    customRatePerUnit: null,
    startDate: new Date('2025-01-01'),
    correlationId: 'cid',
    ...overrides,
  };
}

const listDefaults: ListDefaults = { defaultQuantity: 1, ratePerUnit: 60 };

describe('SubscriptionEntity amount (override-first)', () => {
  it('uses list defaults when no override', () => {
    const e = SubscriptionEntity.create(baseProps());
    expect(e.effectiveQuantity(listDefaults)).toBe(1);
    expect(e.effectiveRate(listDefaults)).toBe(60);
    expect(e.amount(listDefaults)).toBe(60);
  });

  it('uses custom override when present', () => {
    const e = SubscriptionEntity.create(baseProps({ customQuantity: 2, customRatePerUnit: 58 }));
    expect(e.amount(listDefaults)).toBe(116);
    expect(e.isCustomQuantity()).toBe(true);
    expect(e.isCustomRate()).toBe(true);
  });

  it('throws when neither override nor default resolves a field', () => {
    const e = SubscriptionEntity.create(baseProps());
    expect(() => e.amount({ defaultQuantity: null, ratePerUnit: 60 })).toThrow();
  });

  it('emits CustomerSubscribedEvent on create', () => {
    const e = SubscriptionEntity.create(baseProps());
    expect(e.getDomainEvents().map((ev) => ev.type)).toContain('CustomerSubscribedEvent');
  });
});

describe('SubscriptionEntity status transitions', () => {
  it('pause then resume', () => {
    const e = SubscriptionEntity.create(baseProps());
    e.pause('cid');
    expect(e.status.value).toBe('PAUSED');
    e.resume('cid');
    expect(e.status.value).toBe('ACTIVE');
  });

  it('end is terminal — cannot resume', () => {
    const e = SubscriptionEntity.create(baseProps());
    e.end('cid');
    expect(e.status.value).toBe('ENDED');
    expect(() => e.resume('cid')).toThrow();
  });

  it('end sets endDate and emits SubscriptionEndedEvent', () => {
    const e = SubscriptionEntity.create(baseProps());
    e.clearDomainEvents();
    e.end('cid');
    expect(e.getProps().endDate).not.toBeNull();
    expect(e.getDomainEvents().map((ev) => ev.type)).toContain('SubscriptionEndedEvent');
  });
});
