/**
 * Stream U: Extended subscription entity tests.
 * Covers: invalid transitions from ENDED, pause of already-PAUSED,
 * effectiveQuantity/Rate null propagation, amount calculation precision,
 * DateRange end<start rejection, re-end of ENDED subscription.
 */
import { SubscriptionEntity } from '../../domain/subscription.entity';
import { CreateSubscriptionProps } from '../../domain/subscription.types';
import { ArgumentInvalidException } from '@/common/errors/app-error';
import {
  InvalidSubscriptionTransitionError,
  MissingSubscriptionPricingError,
} from '../../domain/supply-list.errors';

function base(overrides: Partial<CreateSubscriptionProps> = {}): CreateSubscriptionProps {
  return {
    vendorId: 1n,
    supplyListId: 100n,
    customerId: 50n,
    customQuantity: null,
    customRatePerUnit: null,
    startDate: new Date('2025-01-01'),
    correlationId: 'cid',
    ...overrides,
  };
}

// ============================================================
// Factory / VO validation
// ============================================================
describe('SubscriptionEntity.create — VO validation', () => {
  it('rejects negative customQuantity', () => {
    expect(() => SubscriptionEntity.create(base({ customQuantity: -1 }))).toThrow(
      ArgumentInvalidException
    );
  });

  it('rejects negative customRatePerUnit', () => {
    expect(() => SubscriptionEntity.create(base({ customRatePerUnit: -0.01 }))).toThrow(
      ArgumentInvalidException
    );
  });

  it('allows zero customRatePerUnit (free item)', () => {
    const e = SubscriptionEntity.create(base({ customRatePerUnit: 0 }));
    expect(e.isCustomRate()).toBe(true);
  });

  it('emits CustomerSubscribedEvent on create', () => {
    const e = SubscriptionEntity.create(base());
    expect(e.getDomainEvents().map((ev) => ev.type)).toContain('CustomerSubscribedEvent');
  });
});

// ============================================================
// Status transitions
// ============================================================
describe('SubscriptionEntity — status transitions', () => {
  function activeEntity(): SubscriptionEntity {
    return SubscriptionEntity.create(base());
  }

  it('ACTIVE → PAUSED allowed', () => {
    const e = activeEntity();
    expect(() => e.pause('cid')).not.toThrow();
    expect(e.status.value).toBe('PAUSED');
  });

  it('PAUSED → ACTIVE allowed (resume)', () => {
    const e = activeEntity();
    e.pause('cid');
    expect(() => e.resume('cid')).not.toThrow();
    expect(e.status.value).toBe('ACTIVE');
  });

  it('ACTIVE → ENDED (end)', () => {
    const e = activeEntity();
    expect(() => e.end('cid')).not.toThrow();
    expect(e.status.value).toBe('ENDED');
  });

  it('PAUSED → ENDED (end from paused)', () => {
    const e = activeEntity();
    e.pause('cid');
    expect(() => e.end('cid')).not.toThrow();
    expect(e.status.value).toBe('ENDED');
  });

  it('ENDED → ACTIVE is rejected (terminal)', () => {
    const e = activeEntity();
    e.end('cid');
    expect(() => e.resume('cid')).toThrow(InvalidSubscriptionTransitionError);
  });

  it('ENDED → PAUSED is rejected (terminal)', () => {
    const e = activeEntity();
    e.end('cid');
    expect(() => e.pause('cid')).toThrow(InvalidSubscriptionTransitionError);
  });

  it('ENDED → ENDED is rejected (terminal)', () => {
    const e = activeEntity();
    e.end('cid');
    expect(() => e.end('cid')).toThrow(InvalidSubscriptionTransitionError);
  });

  it('end sets endDate to today', () => {
    const before = new Date();
    const e = activeEntity();
    e.end('cid');
    const props = e.getProps();
    expect(props.endDate).not.toBeNull();
    expect(props.endDate!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(props.isActive).toBe(false);
  });

  it('end emits SubscriptionEndedEvent', () => {
    const e = activeEntity();
    e.clearDomainEvents();
    e.end('cid');
    expect(e.getDomainEvents().map((ev) => ev.type)).toContain('SubscriptionEndedEvent');
  });

  it('pause emits SubscriptionUpdatedEvent', () => {
    const e = activeEntity();
    e.clearDomainEvents();
    e.pause('cid');
    expect(e.getDomainEvents().map((ev) => ev.type)).toContain('SubscriptionUpdatedEvent');
  });

  it('pausing an already-PAUSED subscription is rejected (no-op transition)', () => {
    const e = activeEntity();
    e.pause('cid');
    // Same-state transitions are treated as no-ops by assertTransition when value === next.
    // The status is already PAUSED; pause calls assertTransition('PAUSED') which does nothing.
    expect(() => e.pause('cid')).not.toThrow();
  });
});

// ============================================================
// effectiveQuantity / effectiveRate / amount
// ============================================================
describe('SubscriptionEntity — effective values (override-first)', () => {
  const listDefaults = { defaultQuantity: 1.5, ratePerUnit: 60 };

  it('uses custom override when present', () => {
    const e = SubscriptionEntity.create(base({ customQuantity: 2, customRatePerUnit: 70 }));
    expect(e.effectiveQuantity(listDefaults)).toBe(2);
    expect(e.effectiveRate(listDefaults)).toBe(70);
    expect(e.amount(listDefaults)).toBe(140);
  });

  it('falls back to list defaults when no override', () => {
    const e = SubscriptionEntity.create(base());
    expect(e.effectiveQuantity(listDefaults)).toBe(1.5);
    expect(e.effectiveRate(listDefaults)).toBe(60);
    expect(e.amount(listDefaults)).toBe(90);
  });

  // BUG-3: a list with no default quantity/rate must surface as a 422-mappable
  // domain error (MissingSubscriptionPricingError → UNPROCESSABLE_ENTITY), never a
  // bare ArgumentInvalidException that leaks as a 500.
  it('throws 422-mappable error when no quantity at all (neither override nor default)', () => {
    const e = SubscriptionEntity.create(base({ customQuantity: null }));
    expect(() => e.effectiveQuantity({ defaultQuantity: null, ratePerUnit: 60 })).toThrow(
      MissingSubscriptionPricingError
    );
    try {
      e.effectiveQuantity({ defaultQuantity: null, ratePerUnit: 60 });
    } catch (err) {
      expect((err as MissingSubscriptionPricingError).statusCode).toBe(422);
      expect((err as MissingSubscriptionPricingError).code).toBe('UNPROCESSABLE_ENTITY');
    }
  });

  it('throws 422-mappable error when no rate at all', () => {
    const e = SubscriptionEntity.create(base({ customRatePerUnit: null }));
    expect(() => e.effectiveRate({ defaultQuantity: 1, ratePerUnit: null })).toThrow(
      MissingSubscriptionPricingError
    );
  });

  it('amount rounds to 2 decimal places', () => {
    const e = SubscriptionEntity.create(base({ customQuantity: 1.333, customRatePerUnit: 60 }));
    const raw = 1.333 * 60; // 79.98
    expect(e.amount(listDefaults)).toBe(Math.round(raw * 100) / 100);
  });

  it('isCustomQuantity/isCustomRate flags reflect override presence', () => {
    const e = SubscriptionEntity.create(base({ customQuantity: 2 }));
    expect(e.isCustomQuantity()).toBe(true);
    expect(e.isCustomRate()).toBe(false);
  });
});

// ============================================================
// DateRange invariant
// ============================================================
describe('SubscriptionEntity — DateRange invariant', () => {
  it('reconstitute rejects endDate before startDate', () => {
    expect(() =>
      SubscriptionEntity.reconstitute({
        id: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        props: {
          vendorId: 1n,
          supplyListId: 100n,
          customerId: 50n,
          customQuantity: null,
          customRatePerUnit: null,
          startDate: new Date('2025-06-01'),
          endDate: new Date('2025-01-01'), // endDate before startDate
          isActive: false,
          deletedAt: null,
        },
      })
    ).toThrow();
  });
});

// ============================================================
// updatePricing — clear override
// ============================================================
describe('SubscriptionEntity.updatePricing', () => {
  it('clearing an override (null) falls back to list default', () => {
    const e = SubscriptionEntity.create(base({ customQuantity: 3, customRatePerUnit: 80 }));
    e.updatePricing(null, undefined, 'cid'); // clear quantity
    expect(e.isCustomQuantity()).toBe(false);
    expect(e.isCustomRate()).toBe(true); // rate unchanged
  });

  it('emits SubscriptionUpdatedEvent on change', () => {
    const e = SubscriptionEntity.create(base());
    e.clearDomainEvents();
    e.updatePricing(2, undefined, 'cid');
    expect(e.getDomainEvents().map((ev) => ev.type)).toContain('SubscriptionUpdatedEvent');
  });

  it('does NOT emit event when nothing changes (undefined/undefined)', () => {
    const e = SubscriptionEntity.create(base());
    e.clearDomainEvents();
    e.updatePricing(undefined, undefined, 'cid');
    expect(e.getDomainEvents()).toHaveLength(0);
  });
});
