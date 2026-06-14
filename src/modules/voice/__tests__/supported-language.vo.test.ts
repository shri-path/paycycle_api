/**
 * Unit tests for SupportedLanguageVO value object.
 */
import { SupportedLanguageVO } from '../domain/value-objects/supported-language.vo';
import { ArgumentInvalidException } from '@/common/errors/app-error';

describe('SupportedLanguageVO', () => {
  describe('create()', () => {
    it('should accept all 9 valid codes (lowercase)', () => {
      const codes = ['en', 'hi', 'ta', 'te', 'mr', 'bn', 'kn', 'ml', 'gu'];
      for (const code of codes) {
        expect(() => SupportedLanguageVO.create(code)).not.toThrow();
        const vo = SupportedLanguageVO.create(code);
        expect(vo.value).toBe(code.toUpperCase());
      }
    });

    it('should accept uppercase codes', () => {
      expect(SupportedLanguageVO.create('HI').value).toBe('HI');
    });

    it('should accept mixed case codes', () => {
      expect(SupportedLanguageVO.create('Hi').value).toBe('HI');
    });

    it('should throw ArgumentInvalidException for unknown code', () => {
      expect(() => SupportedLanguageVO.create('fr')).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for empty string', () => {
      expect(() => SupportedLanguageVO.create('')).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for numeric code', () => {
      expect(() => SupportedLanguageVO.create('123')).toThrow(ArgumentInvalidException);
    });
  });

  describe('toLocale()', () => {
    it('should return hi-IN for HI', () => {
      expect(SupportedLanguageVO.create('hi').toLocale()).toBe('hi-IN');
    });

    it('should return en-IN for EN', () => {
      expect(SupportedLanguageVO.create('en').toLocale()).toBe('en-IN');
    });

    it('should return ta-IN for TA', () => {
      expect(SupportedLanguageVO.create('ta').toLocale()).toBe('ta-IN');
    });
  });

  describe('hasScript()', () => {
    it('should return false for EN (no script to transliterate)', () => {
      expect(SupportedLanguageVO.create('en').hasScript()).toBe(false);
    });

    it('should return true for HI', () => {
      expect(SupportedLanguageVO.create('hi').hasScript()).toBe(true);
    });

    it('should return true for TA', () => {
      expect(SupportedLanguageVO.create('ta').hasScript()).toBe(true);
    });

    it('should return true for all non-English codes', () => {
      const nonEnglish = ['hi', 'ta', 'te', 'mr', 'bn', 'kn', 'ml', 'gu'];
      for (const code of nonEnglish) {
        expect(SupportedLanguageVO.create(code).hasScript()).toBe(true);
      }
    });
  });

  describe('equals()', () => {
    it('should be equal for same language code', () => {
      const a = SupportedLanguageVO.create('hi');
      const b = SupportedLanguageVO.create('hi');
      expect(a.equals(b)).toBe(true);
    });

    it('should not be equal for different codes', () => {
      const a = SupportedLanguageVO.create('hi');
      const b = SupportedLanguageVO.create('en');
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('toString()', () => {
    it('should return the uppercase code', () => {
      expect(SupportedLanguageVO.create('hi').toString()).toBe('HI');
    });
  });
});
