import { ArgumentInvalidException } from '@/common/errors/app-error';

/** Non-negative money rate per unit (2 dp, implicit INR). Zero allowed (free item). */
export class RateMoney {
  private readonly _amount: number;

  private constructor(amount: number) {
    this._amount = amount;
  }

  static create(raw: number): RateMoney {
    if (!Number.isFinite(raw)) {
      throw new ArgumentInvalidException('Rate must be a finite number');
    }
    if (raw < 0) {
      throw new ArgumentInvalidException('Rate must be greater than or equal to 0');
    }
    return new RateMoney(Math.round(raw * 100) / 100);
  }

  get amount(): number {
    return this._amount;
  }

  equals(other?: RateMoney): boolean {
    if (!other) return false;
    return this._amount === other._amount;
  }
}
