import { ArgumentInvalidException } from './phone-number.value-object';

// bcrypt output is always exactly 60 characters
const MIN_BCRYPT_LENGTH = 60;

export class HashedPassword {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
  }

  static create(hash: string): HashedPassword {
    if (!hash || hash.trim().length === 0) {
      throw new ArgumentInvalidException('Hashed password must not be empty');
    }

    if (hash.length < MIN_BCRYPT_LENGTH) {
      throw new ArgumentInvalidException(
        `Hashed password must be at least ${MIN_BCRYPT_LENGTH} characters (bcrypt output)`
      );
    }

    return new HashedPassword(hash);
  }

  unpack(): string {
    return this._value;
  }
}
