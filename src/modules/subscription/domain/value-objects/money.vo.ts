/**
 * Money value object — INR, non-negative, max 99999999.99, 2dp.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';

const MAX_AMOUNT = 99_999_999.99;

export class MoneyVO {
  private constructor(private readonly _amount: number) {}

  static of(amount: number): MoneyVO {
    if (!isFinite(amount)) {
      throw new ArgumentInvalidException('Money amount must be a finite number');
    }
    if (amount < 0) {
      throw new ArgumentInvalidException('Money amount must be >= 0');
    }
    if (amount > MAX_AMOUNT) {
      throw new ArgumentInvalidException(`Money amount must be <= ${MAX_AMOUNT}`);
    }
    return new MoneyVO(MoneyVO.round2(amount));
  }

  static zero(): MoneyVO {
    return new MoneyVO(0);
  }

  private static round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  multiply(factor: number): MoneyVO {
    const result = MoneyVO.round2(this._amount * factor);
    return MoneyVO.of(Math.max(0, result));
  }

  subtract(other: MoneyVO): MoneyVO {
    const result = MoneyVO.round2(this._amount - other._amount);
    return MoneyVO.of(Math.max(0, result));
  }

  get amount(): number {
    return this._amount;
  }

  equals(other: MoneyVO): boolean {
    return this._amount === other._amount;
  }
}
