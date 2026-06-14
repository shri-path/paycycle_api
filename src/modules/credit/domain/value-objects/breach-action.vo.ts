import { ArgumentInvalidException } from '@/common/errors/app-error';
import { CreditBreachActionEnum } from '../credit.types';

export class BreachActionVO {
  private readonly _value: CreditBreachActionEnum;

  private constructor(value: CreditBreachActionEnum) {
    this._value = value;
  }

  static create(value: string): BreachActionVO {
    if (!Object.values(CreditBreachActionEnum).includes(value as CreditBreachActionEnum)) {
      throw new ArgumentInvalidException(
        `Invalid breach action: "${value}". Must be one of ${Object.values(CreditBreachActionEnum).join(', ')}`
      );
    }
    return new BreachActionVO(value as CreditBreachActionEnum);
  }

  unpack(): CreditBreachActionEnum {
    return this._value;
  }

  equals(other: BreachActionVO): boolean {
    return this._value === other._value;
  }
}
