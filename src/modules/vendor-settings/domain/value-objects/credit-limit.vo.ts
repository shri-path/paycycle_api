/**
 * CreditLimit value object.
 * Validates: decimal string >= 0, max 10 integer digits / 2 decimal places.
 * Framework-free.
 */
import { InvalidCreditLimitError } from '../vendor-settings.errors';

// e.g. "2000.50", "0", "9999999999.99"
const CREDIT_LIMIT_REGEX = /^\d{1,10}(\.\d{1,2})?$/;

export class CreditLimit {
  private constructor(private readonly _value: string) {}

  get value(): string {
    return this._value;
  }

  static create(value: string): CreditLimit {
    if (typeof value !== 'string' || !CREDIT_LIMIT_REGEX.test(value)) {
      throw new InvalidCreditLimitError(value);
    }
    const numeric = parseFloat(value);
    if (isNaN(numeric) || numeric < 0) {
      throw new InvalidCreditLimitError(value);
    }
    return new CreditLimit(value);
  }

  unpack(): string {
    return this._value;
  }

  equals(other: CreditLimit): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
