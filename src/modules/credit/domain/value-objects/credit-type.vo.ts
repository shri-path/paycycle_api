import { ArgumentInvalidException } from '@/common/errors/app-error';
import { CreditTypeEnum } from '../credit.types';

export class CreditTypeVO {
  private readonly _value: CreditTypeEnum;

  private constructor(value: CreditTypeEnum) {
    this._value = value;
  }

  static create(value: string): CreditTypeVO {
    if (!Object.values(CreditTypeEnum).includes(value as CreditTypeEnum)) {
      throw new ArgumentInvalidException(
        `Invalid credit type: "${value}". Must be one of ${Object.values(CreditTypeEnum).join(', ')}`
      );
    }
    return new CreditTypeVO(value as CreditTypeEnum);
  }

  unpack(): CreditTypeEnum {
    return this._value;
  }

  equals(other: CreditTypeVO): boolean {
    return this._value === other._value;
  }
}
