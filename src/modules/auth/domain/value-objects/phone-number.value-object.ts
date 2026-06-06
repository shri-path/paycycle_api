import { ArgumentInvalidException } from '@/common/errors/app-error';

const PHONE_REGEX = /^\+?[1-9][0-9]{7,14}$/;

export class PhoneNumber {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(value: string): PhoneNumber {
    const trimmed = (value ?? '').trim();

    if (!trimmed) {
      throw new ArgumentInvalidException('Phone number must not be empty');
    }

    if (!PHONE_REGEX.test(trimmed)) {
      throw new ArgumentInvalidException(
        `Invalid phone number format: "${trimmed}". Must match ^[+]?[1-9][0-9]{7,14}$`
      );
    }

    return new PhoneNumber(trimmed);
  }

  unpack(): string {
    return this._value;
  }

  equals(other: PhoneNumber): boolean {
    return this._value === other._value;
  }
}
