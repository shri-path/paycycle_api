/**
 * BillLanguagePolicyVO — determines which language a bill is rendered in.
 * Pure domain, no framework imports.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { BillLanguagePolicyValue } from '../voice.types';
import { SupportedLanguageVO } from './supported-language.vo';
import { SupportedLanguageCode } from '../voice.types';

const VALID_POLICIES = new Set(Object.values(BillLanguagePolicyValue));

export class BillLanguagePolicyVO {
  readonly value: BillLanguagePolicyValue;

  private constructor(value: BillLanguagePolicyValue) {
    this.value = value;
  }

  static create(raw: string): BillLanguagePolicyVO {
    const upper = raw.toUpperCase();
    if (!VALID_POLICIES.has(upper as BillLanguagePolicyValue)) {
      throw new ArgumentInvalidException(
        `Invalid bill language policy: "${raw}". Must be one of: ${[...VALID_POLICIES].join(', ')}`
      );
    }
    return new BillLanguagePolicyVO(upper as BillLanguagePolicyValue);
  }

  /**
   * Resolves the final language to use for the bill.
   * CUSTOMER → customer's language; MY_LANGUAGE → owner's; ENGLISH → always EN.
   */
  resolve(ownerLang: SupportedLanguageVO, customerLang: SupportedLanguageVO): SupportedLanguageVO {
    switch (this.value) {
      case BillLanguagePolicyValue.CUSTOMER:
        return customerLang;
      case BillLanguagePolicyValue.MY_LANGUAGE:
        return ownerLang;
      case BillLanguagePolicyValue.ENGLISH:
        return SupportedLanguageVO.create(SupportedLanguageCode.EN);
    }
  }

  equals(other: BillLanguagePolicyVO): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
