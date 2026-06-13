/**
 * Unit tests for CreditPeriod value object.
 */
import { CreditPeriod } from '../domain/value-objects/credit-period.vo';
import { InvalidCreditPeriodError } from '../domain/vendor-settings.errors';

describe('CreditPeriod VO', () => {
  describe('create()', () => {
    it('should accept 1 (minimum)', () => {
      const vo = CreditPeriod.create(1);
      expect(vo.days).toBe(1);
    });

    it('should accept 30 (common monthly)', () => {
      const vo = CreditPeriod.create(30);
      expect(vo.days).toBe(30);
    });

    it('should accept 365 (maximum)', () => {
      expect(() => CreditPeriod.create(365)).not.toThrow();
    });

    it('should reject 0', () => {
      expect(() => CreditPeriod.create(0)).toThrow(InvalidCreditPeriodError);
    });

    it('should reject 366', () => {
      expect(() => CreditPeriod.create(366)).toThrow(InvalidCreditPeriodError);
    });

    it('should reject negative values', () => {
      expect(() => CreditPeriod.create(-1)).toThrow(InvalidCreditPeriodError);
    });

    it('should reject non-integer 1.5', () => {
      expect(() => CreditPeriod.create(1.5)).toThrow(InvalidCreditPeriodError);
    });
  });

  describe('unpack()', () => {
    it('should return the integer value', () => {
      expect(CreditPeriod.create(30).unpack()).toBe(30);
    });
  });

  describe('equals()', () => {
    it('should return true for same value', () => {
      expect(CreditPeriod.create(30).equals(CreditPeriod.create(30))).toBe(true);
    });

    it('should return false for different values', () => {
      expect(CreditPeriod.create(30).equals(CreditPeriod.create(31))).toBe(false);
    });
  });
});
