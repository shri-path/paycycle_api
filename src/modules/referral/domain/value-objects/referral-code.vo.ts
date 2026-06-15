/**
 * ReferralCode Value Object — validates and encapsulates a referral code.
 * Format: [BUSINESSPREFIX][4DIGITS] e.g. MILK1234
 */
import { BadRequestError } from '@/common/errors/app-error';

export class ReferralCode {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(value: string): ReferralCode {
    if (!value || value.trim().length === 0) {
      throw new BadRequestError('Referral code cannot be empty');
    }
    const normalized = value.trim().toUpperCase();
    if (normalized.length < 4 || normalized.length > 20) {
      throw new BadRequestError('Referral code must be 4-20 characters');
    }
    if (!/^[A-Z0-9]+$/.test(normalized)) {
      throw new BadRequestError('Referral code must contain only letters and digits');
    }
    return new ReferralCode(normalized);
  }

  /**
   * Generate a referral code from a vendor name prefix.
   * Format: first 4 uppercase letters of business name + 4 random digits.
   */
  static generate(businessName: string): ReferralCode {
    const prefix = businessName
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .substring(0, 4)
      .padEnd(4, 'X');
    const digits = String(Math.floor(1000 + Math.random() * 9000));
    return new ReferralCode(prefix + digits);
  }

  get value(): string {
    return this._value;
  }

  equals(other?: ReferralCode): boolean {
    if (!other) return false;
    return this._value === other._value;
  }

  unpack(): string {
    return this._value;
  }

  toString(): string {
    return this._value;
  }
}
