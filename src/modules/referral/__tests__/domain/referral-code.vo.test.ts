/**
 * Unit tests — ReferralCode value object.
 * Covers: creation, validation, code generation, uniqueness distribution.
 */
import { ReferralCode } from '../../domain/value-objects/referral-code.vo';

describe('ReferralCode VO', () => {
  describe('create()', () => {
    it('should accept valid alphanumeric code', () => {
      const code = ReferralCode.create('MILK1234');
      expect(code.value).toBe('MILK1234');
    });

    it('should normalize to uppercase', () => {
      const code = ReferralCode.create('milk1234');
      expect(code.value).toBe('MILK1234');
    });

    it('should throw on empty string', () => {
      expect(() => ReferralCode.create('')).toThrow('Referral code cannot be empty');
    });

    it('should throw if code is too short (< 4 chars)', () => {
      expect(() => ReferralCode.create('ABC')).toThrow('4-20 characters');
    });

    it('should throw if code is too long (> 20 chars)', () => {
      expect(() => ReferralCode.create('ABCDEFGHIJKLMNOPQRSTU')).toThrow('4-20 characters');
    });

    it('should throw if code contains special characters', () => {
      expect(() => ReferralCode.create('MILK-1234')).toThrow('only letters and digits');
    });
  });

  describe('generate()', () => {
    it('should generate an 8-character code', () => {
      const code = ReferralCode.generate('Milk Depot');
      expect(code.value).toHaveLength(8);
    });

    it('should start with 4 uppercase alpha prefix from business name', () => {
      const code = ReferralCode.generate('Shrihari');
      expect(code.value.substring(0, 4)).toBe('SHRI');
    });

    it('should end with 4 digits', () => {
      const code = ReferralCode.generate('Vendor');
      const digits = code.value.substring(4);
      expect(/^\d{4}$/.test(digits)).toBe(true);
      const numVal = parseInt(digits, 10);
      expect(numVal).toBeGreaterThanOrEqual(1000);
      expect(numVal).toBeLessThanOrEqual(9999);
    });

    it('should pad short business names with X', () => {
      const code = ReferralCode.generate('AB');
      expect(code.value.substring(0, 4)).toBe('ABXX');
    });

    it('should strip non-alpha characters from business name', () => {
      // 'M!LK 2024' → strip non-alpha → 'MLK' (3 chars) → padded to 'MLKX'
      const code = ReferralCode.generate('M!LK 2024');
      expect(code.value.substring(0, 4)).toBe('MLKX');
    });

    it('should generate codes with different digits (distribution check)', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 20; i++) {
        codes.add(ReferralCode.generate('Vendor').value);
      }
      // Not all 20 should be identical (extremely low probability)
      expect(codes.size).toBeGreaterThan(1);
    });
  });

  describe('equals()', () => {
    it('should return true for same value', () => {
      const a = ReferralCode.create('MILK1234');
      const b = ReferralCode.create('MILK1234');
      expect(a.equals(b)).toBe(true);
    });

    it('should return false for different values', () => {
      const a = ReferralCode.create('MILK1234');
      const b = ReferralCode.create('SHOP5678');
      expect(a.equals(b)).toBe(false);
    });

    it('should return false for undefined', () => {
      const a = ReferralCode.create('MILK1234');
      expect(a.equals(undefined)).toBe(false);
    });
  });

  describe('unpack() / toString()', () => {
    it('unpack should return the raw string', () => {
      const code = ReferralCode.create('MILK1234');
      expect(code.unpack()).toBe('MILK1234');
    });

    it('toString should return the raw string', () => {
      const code = ReferralCode.create('MILK1234');
      expect(code.toString()).toBe('MILK1234');
    });
  });
});
