import { ArgumentInvalidException } from '@/common/errors/app-error';

export class CustomerNameVO {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(raw: string): CustomerNameVO {
    const trimmed = (raw ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 100) {
      throw new ArgumentInvalidException('Customer name must be 1–100 characters');
    }
    return new CustomerNameVO(trimmed);
  }

  unpack(): string {
    return this._value;
  }

  equals(other: CustomerNameVO): boolean {
    return this._value === other._value;
  }
}
