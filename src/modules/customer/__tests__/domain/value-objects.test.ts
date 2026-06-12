/* eslint-disable @typescript-eslint/no-explicit-any */
import { CustomerNameVO } from '../../domain/value-objects/customer-name.vo';
import { CustomerPhoneVO } from '../../domain/value-objects/customer-phone.vo';
import { CreditLimitVO } from '../../domain/value-objects/credit-limit.vo';
import { PaymentScoreVO } from '../../domain/value-objects/payment-score.vo';

describe('CustomerNameVO', () => {
  it('creates a valid name', () => {
    const vo = CustomerNameVO.create('  Ravi Kumar  ');
    expect(vo.unpack()).toBe('Ravi Kumar');
  });

  it('throws on empty string', () => {
    expect(() => CustomerNameVO.create('')).toThrow();
  });

  it('throws on name longer than 100 chars', () => {
    expect(() => CustomerNameVO.create('a'.repeat(101))).toThrow();
  });

  it('equals returns true for same value', () => {
    const a = CustomerNameVO.create('Ravi');
    const b = CustomerNameVO.create('Ravi');
    expect(a.equals(b)).toBe(true);
  });

  it('equals returns false for different values', () => {
    const a = CustomerNameVO.create('Ravi');
    const b = CustomerNameVO.create('Priya');
    expect(a.equals(b)).toBe(false);
  });
});

describe('CustomerPhoneVO', () => {
  it('creates valid 10-digit phone with default +91', () => {
    const vo = CustomerPhoneVO.create('9876543210');
    expect(vo.unpack()).toBe('+919876543210');
    expect(vo.digits).toBe('9876543210');
    expect(vo.countryCode).toBe('+91');
  });

  it('strips spaces and dashes', () => {
    const vo = CustomerPhoneVO.create('98765-43210');
    expect(vo.digits).toBe('9876543210');
  });

  it('throws on empty input', () => {
    expect(() => CustomerPhoneVO.create('')).toThrow();
  });

  it('throws on less than 10 digits', () => {
    expect(() => CustomerPhoneVO.create('123456789')).toThrow();
  });

  it('throws on more than 10 digits', () => {
    expect(() => CustomerPhoneVO.create('12345678901')).toThrow();
  });

  it('equals returns true for same number', () => {
    const a = CustomerPhoneVO.create('9876543210');
    const b = CustomerPhoneVO.create('9876543210');
    expect(a.equals(b)).toBe(true);
  });
});

describe('CreditLimitVO', () => {
  it('creates zero limit', () => {
    const vo = CreditLimitVO.create(0);
    expect(vo.unpack()).toBe(0);
  });

  it('creates positive limit', () => {
    const vo = CreditLimitVO.create(500);
    expect(vo.unpack()).toBe(500);
  });

  it('creates max limit', () => {
    const vo = CreditLimitVO.create(9_999_999.99);
    expect(vo.unpack()).toBe(9_999_999.99);
  });

  it('throws on negative value', () => {
    expect(() => CreditLimitVO.create(-1)).toThrow();
  });

  it('throws on value exceeding max', () => {
    expect(() => CreditLimitVO.create(10_000_000)).toThrow();
  });

  it('throws on Infinity', () => {
    expect(() => CreditLimitVO.create(Infinity)).toThrow();
  });

  it('equals returns true for same value', () => {
    expect(CreditLimitVO.create(500).equals(CreditLimitVO.create(500))).toBe(true);
  });
});

describe('PaymentScoreVO', () => {
  it('creates valid score', () => {
    const vo = PaymentScoreVO.create(100);
    expect(vo.unpack()).toBe(100);
  });

  it('creates min score (0)', () => {
    const vo = PaymentScoreVO.create(0);
    expect(vo.unpack()).toBe(0);
  });

  it('throws on score > 100', () => {
    expect(() => PaymentScoreVO.create(101)).toThrow();
  });

  it('throws on negative score', () => {
    expect(() => PaymentScoreVO.create(-1)).toThrow();
  });

  it('throws on NaN', () => {
    expect(() => PaymentScoreVO.create(NaN)).toThrow();
  });
});
