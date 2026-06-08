import { ArgumentInvalidException } from '@/common/errors/app-error';

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

  /**
   * Structural equality by hash string comparison.
   * Note: identical passwords produce different bcrypt hashes — use bcrypt.compare() for
   * actual password verification; this method is for value-object identity only.
   */
  equals(other: HashedPassword): boolean {
    return this._value === other._value;
  }
}
