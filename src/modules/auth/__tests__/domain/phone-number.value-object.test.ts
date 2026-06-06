import {
  PhoneNumber,
  ArgumentInvalidException,
} from '../../domain/value-objects/phone-number.value-object';

describe('PhoneNumber VO', () => {
  describe('valid phone numbers', () => {
    it('accepts +919876543210', () => {
      const phone = PhoneNumber.create('+919876543210');
      expect(phone.unpack()).toBe('+919876543210');
    });

    it('accepts +12345678901', () => {
      const phone = PhoneNumber.create('+12345678901');
      expect(phone.unpack()).toBe('+12345678901');
    });

    it('accepts 9876543210 (without +)', () => {
      const phone = PhoneNumber.create('9876543210');
      expect(phone.unpack()).toBe('9876543210');
    });

    it('trims whitespace before validation', () => {
      const phone = PhoneNumber.create('  +919876543210  ');
      expect(phone.unpack()).toBe('+919876543210');
    });
  });

  describe('invalid phone numbers', () => {
    it('rejects empty string', () => {
      expect(() => PhoneNumber.create('')).toThrow(ArgumentInvalidException);
    });

    it('rejects non-numeric string', () => {
      expect(() => PhoneNumber.create('abc')).toThrow(ArgumentInvalidException);
    });

    it('rejects too-short number', () => {
      expect(() => PhoneNumber.create('123')).toThrow(ArgumentInvalidException);
    });

    it('rejects phone starting with +0', () => {
      expect(() => PhoneNumber.create('+0123456789')).toThrow(ArgumentInvalidException);
    });
  });

  describe('unpack', () => {
    it('returns the original value', () => {
      const phone = PhoneNumber.create('+919876543210');
      expect(phone.unpack()).toBe('+919876543210');
    });
  });

  describe('equals', () => {
    it('returns true for same phone', () => {
      const a = PhoneNumber.create('+919876543210');
      const b = PhoneNumber.create('+919876543210');
      expect(a.equals(b)).toBe(true);
    });

    it('returns false for different phones', () => {
      const a = PhoneNumber.create('+919876543210');
      const b = PhoneNumber.create('+919000000001');
      expect(a.equals(b)).toBe(false);
    });
  });
});
