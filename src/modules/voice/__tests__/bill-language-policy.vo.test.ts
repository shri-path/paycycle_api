/**
 * Unit tests for BillLanguagePolicyVO value object.
 */
import { BillLanguagePolicyVO } from '../domain/value-objects/bill-language-policy.vo';
import { SupportedLanguageVO } from '../domain/value-objects/supported-language.vo';
import { ArgumentInvalidException } from '@/common/errors/app-error';

const hiLang = () => SupportedLanguageVO.create('hi');
const taLang = () => SupportedLanguageVO.create('ta');
const enLang = () => SupportedLanguageVO.create('en');

describe('BillLanguagePolicyVO', () => {
  describe('create()', () => {
    it('should accept CUSTOMER (lowercase)', () => {
      const vo = BillLanguagePolicyVO.create('customer');
      expect(vo.value).toBe('CUSTOMER');
    });

    it('should accept MY_LANGUAGE', () => {
      const vo = BillLanguagePolicyVO.create('MY_LANGUAGE');
      expect(vo.value).toBe('MY_LANGUAGE');
    });

    it('should accept ENGLISH', () => {
      const vo = BillLanguagePolicyVO.create('ENGLISH');
      expect(vo.value).toBe('ENGLISH');
    });

    it('should throw ArgumentInvalidException for unknown policy', () => {
      expect(() => BillLanguagePolicyVO.create('NONE')).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for empty string', () => {
      expect(() => BillLanguagePolicyVO.create('')).toThrow(ArgumentInvalidException);
    });
  });

  describe('resolve()', () => {
    it('CUSTOMER → returns customer language', () => {
      const policy = BillLanguagePolicyVO.create('CUSTOMER');
      const result = policy.resolve(hiLang(), taLang());
      expect(result.value).toBe('TA');
    });

    it('MY_LANGUAGE → returns owner language', () => {
      const policy = BillLanguagePolicyVO.create('MY_LANGUAGE');
      const result = policy.resolve(hiLang(), taLang());
      expect(result.value).toBe('HI');
    });

    it('ENGLISH → always returns EN regardless of owner or customer language', () => {
      const policy = BillLanguagePolicyVO.create('ENGLISH');
      const result = policy.resolve(hiLang(), taLang());
      expect(result.value).toBe('EN');
    });

    it('CUSTOMER when customer is EN → returns EN', () => {
      const policy = BillLanguagePolicyVO.create('CUSTOMER');
      const result = policy.resolve(hiLang(), enLang());
      expect(result.value).toBe('EN');
    });

    it('MY_LANGUAGE when both same → returns same', () => {
      const policy = BillLanguagePolicyVO.create('MY_LANGUAGE');
      const result = policy.resolve(hiLang(), hiLang());
      expect(result.value).toBe('HI');
    });
  });

  describe('equals()', () => {
    it('should be equal for same policy', () => {
      expect(
        BillLanguagePolicyVO.create('CUSTOMER').equals(BillLanguagePolicyVO.create('CUSTOMER'))
      ).toBe(true);
    });

    it('should not be equal for different policies', () => {
      expect(
        BillLanguagePolicyVO.create('CUSTOMER').equals(BillLanguagePolicyVO.create('ENGLISH'))
      ).toBe(false);
    });
  });
});
