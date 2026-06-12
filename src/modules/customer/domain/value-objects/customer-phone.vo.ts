import { ArgumentInvalidException } from '@/common/errors/app-error';

const DIGITS_ONLY_RE = /^\d+$/;

/**
 * CustomerPhoneVO — normalizes a 10-digit Indian mobile number.
 * Strips spaces and dashes; validates exactly 10 digits.
 * Stores the full E.164-style value (countryCode + 10 digits).
 */
export class CustomerPhoneVO {
  private readonly _digits: string;
  private readonly _countryCode: string;

  private constructor(digits: string, countryCode: string) {
    this._digits = digits;
    this._countryCode = countryCode;
  }

  static create(raw: string, countryCode = '+91'): CustomerPhoneVO {
    const stripped = (raw ?? '').replace(/[\s\-()]/g, '');
    if (!stripped) {
      throw new ArgumentInvalidException('Phone number must not be empty');
    }
    // Remove leading country code digits if pasted with it (e.g., "+919876543210")
    const digitsOnly = stripped.startsWith('+')
      ? stripped.slice(1).replace(/^\d{1,3}/, (cc) => {
          // remove up to 3-digit country code prefix if present
          const code = countryCode.replace('+', '');
          return stripped.slice(1).startsWith(code) ? stripped.slice(1 + code.length) : cc;
        })
      : stripped;

    // After stripping, should have exactly 10 digits
    const normalized = digitsOnly.replace(countryCode.replace('+', ''), '');
    const finalDigits =
      DIGITS_ONLY_RE.test(normalized) && normalized.length === 10 ? normalized : digitsOnly;

    if (!DIGITS_ONLY_RE.test(finalDigits) || finalDigits.length !== 10) {
      throw new ArgumentInvalidException(
        `Phone number must be exactly 10 digits (got "${stripped}")`
      );
    }

    const cc = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
    return new CustomerPhoneVO(finalDigits, cc);
  }

  /** Full E.164 phone number (e.g., "+919876543210") */
  unpack(): string {
    return `${this._countryCode}${this._digits}`;
  }

  /** The 10-digit part only */
  get digits(): string {
    return this._digits;
  }

  get countryCode(): string {
    return this._countryCode;
  }

  equals(other: CustomerPhoneVO): boolean {
    return this._digits === other._digits && this._countryCode === other._countryCode;
  }
}
