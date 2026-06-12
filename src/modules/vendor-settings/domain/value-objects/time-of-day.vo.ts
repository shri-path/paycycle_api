/**
 * TimeOfDay value object — "HH:mm" string in 24-hour format.
 * Validates: 00:00–23:59. Immutable.
 * Framework-free.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class TimeOfDay {
  private constructor(
    private readonly _hours: number,
    private readonly _minutes: number
  ) {}

  get hours(): number {
    return this._hours;
  }

  get minutes(): number {
    return this._minutes;
  }

  static create(value: string): TimeOfDay {
    if (!value || typeof value !== 'string') {
      throw new ArgumentInvalidException('TimeOfDay: value must be a non-empty string');
    }
    if (!TIME_REGEX.test(value)) {
      throw new ArgumentInvalidException(
        `TimeOfDay: "${value}" is not a valid 24-hour time (expected HH:mm, 00:00–23:59)`
      );
    }
    const [hPart, mPart] = value.split(':');
    const hours = parseInt(hPart!, 10);
    const minutes = parseInt(mPart!, 10);
    return new TimeOfDay(hours, minutes);
  }

  /** Serialize back to "HH:mm" string for persistence. */
  unpack(): string {
    const hh = String(this._hours).padStart(2, '0');
    const mm = String(this._minutes).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  equals(other: TimeOfDay): boolean {
    return this._hours === other._hours && this._minutes === other._minutes;
  }

  toString(): string {
    return this.unpack();
  }
}
