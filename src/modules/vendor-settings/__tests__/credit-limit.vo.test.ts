/**
 * Unit tests for CreditLimit value object.
 */
import { CreditLimit } from '../domain/value-objects/credit-limit.vo';
import { InvalidCreditLimitError } from '../domain/vendor-settings.errors';

describe('CreditLimit VO', () => {
  describe('create()', () => {
    it('should accept "0" (zero credit)', () => {
      const vo = CreditLimit.create('0');
      expect(vo.value).toBe('0');
    });

    it('should accept "2000" (no decimals)', () => {
      const vo = CreditLimit.create('2000');
      expect(vo.value).toBe('2000');
    });

    it('should accept "9999999999.99" (max boundary)', () => {
      expect(() => CreditLimit.create('9999999999.99')).not.toThrow();
    });

    it('should accept "1500.50" (two decimal places)', () => {
      const vo = CreditLimit.create('1500.50');
      expect(vo.value).toBe('1500.50');
    });

    it('should reject negative value "-1"', () => {
      expect(() => CreditLimit.create('-1')).toThrow(InvalidCreditLimitError);
    });

    it('should reject more than 2 decimal places "100.123"', () => {
      expect(() => CreditLimit.create('100.123')).toThrow(InvalidCreditLimitError);
    });

    it('should reject empty string', () => {
      expect(() => CreditLimit.create('')).toThrow(InvalidCreditLimitError);
    });

    it('should reject non-numeric string "abc"', () => {
      expect(() => CreditLimit.create('abc')).toThrow(InvalidCreditLimitError);
    });
  });

  describe('unpack()', () => {
    it('should return the original string value', () => {
      expect(CreditLimit.create('2000').unpack()).toBe('2000');
    });
  });

  describe('equals()', () => {
    it('should return true for same value', () => {
      expect(CreditLimit.create('500').equals(CreditLimit.create('500'))).toBe(true);
    });

    it('should return false for different values', () => {
      expect(CreditLimit.create('500').equals(CreditLimit.create('501'))).toBe(false);
    });
  });
});
