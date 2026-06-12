import { ArgumentInvalidException } from '@/common/errors/app-error';

export class PaymentScoreVO {
  private readonly _value: number;

  private constructor(value: number) {
    this._value = value;
  }

  static create(value: number): PaymentScoreVO {
    if (!isFinite(value) || value < 0 || value > 100) {
      throw new ArgumentInvalidException('Payment score must be between 0 and 100');
    }
    return new PaymentScoreVO(value);
  }

  unpack(): number {
    return this._value;
  }

  equals(other: PaymentScoreVO): boolean {
    return this._value === other._value;
  }
}
