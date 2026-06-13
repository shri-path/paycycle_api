/**
 * CreditPeriod value object.
 * Validates: integer between 1 and 365 inclusive.
 * Framework-free.
 */
import { InvalidCreditPeriodError } from '../vendor-settings.errors';

export class CreditPeriod {
  private constructor(private readonly _days: number) {}

  get days(): number {
    return this._days;
  }

  static create(value: number): CreditPeriod {
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      throw new InvalidCreditPeriodError(value);
    }
    return new CreditPeriod(value);
  }

  unpack(): number {
    return this._days;
  }

  equals(other: CreditPeriod): boolean {
    return this._days === other._days;
  }

  toString(): string {
    return String(this._days);
  }
}
