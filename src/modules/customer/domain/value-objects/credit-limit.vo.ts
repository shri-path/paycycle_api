import { ArgumentInvalidException } from '@/common/errors/app-error';

const MAX_CREDIT = 9_999_999.99;

export class CreditLimitVO {
  private readonly _value: number;

  private constructor(value: number) {
    this._value = value;
  }

  static create(value: number): CreditLimitVO {
    if (!isFinite(value) || value < 0 || value > MAX_CREDIT) {
      throw new ArgumentInvalidException(`Credit limit must be between 0 and ${MAX_CREDIT}`);
    }
    return new CreditLimitVO(value);
  }

  unpack(): number {
    return this._value;
  }

  equals(other: CreditLimitVO): boolean {
    return this._value === other._value;
  }
}
