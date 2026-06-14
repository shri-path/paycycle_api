import { ArgumentInvalidException } from '@/common/errors/app-error';

export class WarningThresholdVO {
  private readonly _percent: number;

  private constructor(percent: number) {
    this._percent = percent;
  }

  static create(percent: number): WarningThresholdVO {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      throw new ArgumentInvalidException(
        `Warning threshold must be an integer between 0 and 100, got ${percent}`
      );
    }
    return new WarningThresholdVO(percent);
  }

  unpack(): number {
    return this._percent;
  }

  equals(other: WarningThresholdVO): boolean {
    return this._percent === other._percent;
  }
}
