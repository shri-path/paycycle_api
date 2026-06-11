import { ArgumentInvalidException } from '@/common/errors/app-error';

/**
 * Subscription date range. startDate required; endDate optional.
 * If endDate present, it must be on or after startDate. Past/future starts allowed.
 */
export class DateRange {
  private readonly _startDate: Date;
  private readonly _endDate: Date | null;

  private constructor(startDate: Date, endDate: Date | null) {
    this._startDate = startDate;
    this._endDate = endDate;
  }

  static create(startDate: Date, endDate: Date | null = null): DateRange {
    if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
      throw new ArgumentInvalidException('startDate must be a valid date');
    }
    if (endDate !== null) {
      if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
        throw new ArgumentInvalidException('endDate must be a valid date');
      }
      if (endDate.getTime() < startDate.getTime()) {
        throw new ArgumentInvalidException('endDate must be on or after startDate');
      }
    }
    return new DateRange(startDate, endDate);
  }

  get startDate(): Date {
    return this._startDate;
  }

  get endDate(): Date | null {
    return this._endDate;
  }

  withEnd(endDate: Date): DateRange {
    return DateRange.create(this._startDate, endDate);
  }

  equals(other?: DateRange): boolean {
    if (!other) return false;
    return (
      this._startDate.getTime() === other._startDate.getTime() &&
      (this._endDate?.getTime() ?? null) === (other._endDate?.getTime() ?? null)
    );
  }
}
