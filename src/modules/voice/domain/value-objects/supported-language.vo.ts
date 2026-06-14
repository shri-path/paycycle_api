/**
 * SupportedLanguageVO — value object for one of the 9 language codes.
 * Pure domain, no framework imports.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { SupportedLanguageCode } from '../voice.types';

const VALID_CODES = new Set(Object.values(SupportedLanguageCode));

export class SupportedLanguageVO {
  readonly value: SupportedLanguageCode;

  private constructor(value: SupportedLanguageCode) {
    this.value = value;
  }

  static create(raw: string): SupportedLanguageVO {
    const upper = raw.toUpperCase();
    if (!VALID_CODES.has(upper as SupportedLanguageCode)) {
      throw new ArgumentInvalidException(
        `Unsupported language code: "${raw}". Must be one of: ${[...VALID_CODES].join(', ')}`
      );
    }
    return new SupportedLanguageVO(upper as SupportedLanguageCode);
  }

  /** Returns the speech-API locale string, e.g. hi-IN */
  toLocale(): string {
    return `${this.value.toLowerCase()}-IN`;
  }

  /** English has no separate script to transliterate to. */
  hasScript(): boolean {
    return this.value !== SupportedLanguageCode.EN;
  }

  equals(other: SupportedLanguageVO): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
