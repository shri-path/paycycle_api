/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CustomerEntity,
  PaymentEntity,
  CustomerStatus,
  PaymentMethod,
} from '../../domain/customer.entity';
import { CustomerNameVO } from '../../domain/value-objects/customer-name.vo';
import { CustomerPhoneVO } from '../../domain/value-objects/customer-phone.vo';
import { CreditLimitVO } from '../../domain/value-objects/credit-limit.vo';
import { PaymentScoreVO } from '../../domain/value-objects/payment-score.vo';

function makeEntity(
  overrides: Partial<Parameters<typeof CustomerEntity.create>[0]> = {}
): CustomerEntity {
  return CustomerEntity.create({
    vendorId: 1n,
    name: 'Test Customer',
    phone: '9876543210',
    ...overrides,
  });
}

describe('CustomerEntity.create', () => {
  it('creates entity with defaults', () => {
    const entity = makeEntity();
    const props = entity.getProps();

    expect(props.status).toBe(CustomerStatus.ACTIVE);
    expect(props.creditLimit.unpack()).toBe(0);
    expect(props.paymentScore.unpack()).toBe(100);
    expect(props.deletedAt).toBeNull();
    expect(props.name.unpack()).toBe('Test Customer');
  });

  it('creates entity with custom credit limit', () => {
    const entity = makeEntity({ creditLimit: 1500 });
    expect(entity.getProps().creditLimit.unpack()).toBe(1500);
  });

  it('throws on invalid name', () => {
    expect(() => makeEntity({ name: '' })).toThrow();
  });

  it('throws on invalid phone', () => {
    expect(() => makeEntity({ phone: '123' })).toThrow();
  });
});

describe('CustomerEntity.reconstitute', () => {
  it('reconstitutes from stored data', () => {
    const entity = CustomerEntity.reconstitute({
      id: 42n,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      props: {
        vendorId: 1n,
        name: CustomerNameVO.create('Ravi'),
        phone: CustomerPhoneVO.create('9876543210'),
        phoneCountryCode: '+91',
        email: null,
        address: null,
        area: null,
        languagePreference: 'en',
        creditLimit: CreditLimitVO.create(500),
        paymentScore: PaymentScoreVO.create(80),
        customerSince: null,
        status: CustomerStatus.ACTIVE,
        createdByUserId: null,
        deletedAt: null,
      },
    });

    expect(entity.id).toBe(42n);
    expect(entity.getProps().name.unpack()).toBe('Ravi');
  });
});

describe('CustomerEntity.update', () => {
  it('updates name', () => {
    const entity = makeEntity();
    entity.update({ name: 'Priya' });
    expect(entity.getProps().name.unpack()).toBe('Priya');
  });

  it('updates status', () => {
    const entity = makeEntity();
    entity.update({ status: CustomerStatus.INACTIVE });
    expect(entity.getProps().status).toBe(CustomerStatus.INACTIVE);
  });

  it('updates email', () => {
    const entity = makeEntity();
    entity.update({ email: 'test@example.com' });
    expect(entity.getProps().email).toBe('test@example.com');
  });
});

describe('CustomerEntity.deactivate', () => {
  it('sets status to INACTIVE and sets deletedAt', () => {
    const entity = makeEntity();
    entity.deactivate();
    expect(entity.getProps().status).toBe(CustomerStatus.INACTIVE);
    expect(entity.getProps().deletedAt).not.toBeNull();
  });

  it('throws if already inactive', () => {
    const entity = makeEntity();
    entity.deactivate();
    expect(() => entity.deactivate()).toThrow();
  });
});

describe('CustomerEntity.reactivate', () => {
  it('sets status back to ACTIVE', () => {
    const entity = makeEntity();
    entity.deactivate();
    entity.reactivate();
    expect(entity.getProps().status).toBe(CustomerStatus.ACTIVE);
    expect(entity.getProps().deletedAt).toBeNull();
  });

  it('throws if already active', () => {
    const entity = makeEntity();
    expect(() => entity.reactivate()).toThrow();
  });
});

describe('CustomerEntity.updateCreditLimit', () => {
  it('updates credit limit', () => {
    const entity = makeEntity();
    entity.updateCreditLimit(2000);
    expect(entity.getProps().creditLimit.unpack()).toBe(2000);
  });
});

describe('PaymentEntity.create', () => {
  it('creates valid payment', () => {
    const entity = PaymentEntity.create({
      customerId: 1n,
      vendorId: 2n,
      amount: 500,
      paymentDate: new Date(),
      paymentMethod: PaymentMethod.CASH,
    });

    const props = entity.getProps();
    expect(props.amount).toBe(500);
    expect(props.paymentMethod).toBe(PaymentMethod.CASH);
    expect(props.referenceNumber).toBeNull();
    expect(props.recordedByUserId).toBeNull();
  });

  it('throws on zero amount', () => {
    expect(() =>
      PaymentEntity.create({
        customerId: 1n,
        vendorId: 2n,
        amount: 0,
        paymentDate: new Date(),
        paymentMethod: PaymentMethod.CASH,
      })
    ).toThrow();
  });

  it('throws on negative amount', () => {
    expect(() =>
      PaymentEntity.create({
        customerId: 1n,
        vendorId: 2n,
        amount: -100,
        paymentDate: new Date(),
        paymentMethod: PaymentMethod.CASH,
      })
    ).toThrow();
  });

  it('throws on future payment date', () => {
    const futureDate = new Date(Date.now() + 48 * 60 * 60 * 1000); // 2 days from now
    expect(() =>
      PaymentEntity.create({
        customerId: 1n,
        vendorId: 2n,
        amount: 100,
        paymentDate: futureDate,
        paymentMethod: PaymentMethod.UPI,
      })
    ).toThrow();
  });
});
