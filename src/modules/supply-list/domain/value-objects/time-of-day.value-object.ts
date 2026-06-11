import { ArgumentInvalidException } from '@/common/errors/app-error';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A wall-clock time of day in HH:mm (00:00–23:59). */
export class TimeOfDay {
  private readonly _hours: number;
  private readonly _minutes: number;

  private constructor(hours: number, minutes: number) {
    this._hours = hours;
    this._minutes = minutes;
  }

  static create(raw: string): TimeOfDay {
    const match = HHMM.exec(raw.trim());
    if (!match) {
      throw new ArgumentInvalidException(`Invalid time format: "${raw}" (expected HH:mm)`);
    }
    return new TimeOfDay(Number(match[1]), Number(match[2]));
  }

  static isValid(raw: string): boolean {
    return HHMM.test(raw.trim());
  }

  get hours(): number {
    return this._hours;
  }

  get minutes(): number {
    return this._minutes;
  }

  unpack(): string {
    const hh = String(this._hours).padStart(2, '0');
    const mm = String(this._minutes).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  equals(other?: TimeOfDay): boolean {
    if (!other) return false;
    return this._hours === other._hours && this._minutes === other._minutes;
  }
}
