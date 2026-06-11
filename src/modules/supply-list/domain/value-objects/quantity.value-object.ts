import { ArgumentInvalidException } from '@/common/errors/app-error';

/** Non-negative decimal quantity (3 dp). */
export class Quantity {
  private readonly _value: number;

  private constructor(value: number) {
    this._value = value;
  }

  static create(raw: number): Quantity {
    if (!Number.isFinite(raw)) {
      throw new ArgumentInvalidException('Quantity must be a finite number');
    }
    if (raw < 0) {
      throw new ArgumentInvalidException('Quantity must be greater than or equal to 0');
    }
    // Normalize to 3 decimal places.
    return new Quantity(Math.round(raw * 1000) / 1000);
  }

  get value(): number {
    return this._value;
  }

  equals(other?: Quantity): boolean {
    if (!other) return false;
    return this._value === other._value;
  }
}
