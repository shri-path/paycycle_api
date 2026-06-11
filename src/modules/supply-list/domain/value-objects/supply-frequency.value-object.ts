import { ArgumentInvalidException } from '@/common/errors/app-error';
import { SupplyFrequency } from '../supply-list.types';

/** A single schedule rule. WEEKLY uses dayOfWeek (1-7); MONTHLY uses dayOfMonth (1-31). */
export interface ScheduleRule {
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
}

/**
 * Frequency + schedule rules value object.
 *  - DAILY   ⇒ no rules
 *  - WEEKLY  ⇒ ≥1 dayOfWeek in 1..7
 *  - MONTHLY ⇒ ≥1 dayOfMonth in 1..31
 */
export class SupplyFrequencyVO {
  private readonly _frequency: SupplyFrequency;
  private readonly _rules: ScheduleRule[];

  private constructor(frequency: SupplyFrequency, rules: ScheduleRule[]) {
    this._frequency = frequency;
    this._rules = rules;
  }

  static create(frequency: SupplyFrequency, rules: ScheduleRule[] = []): SupplyFrequencyVO {
    if (!Object.values(SupplyFrequency).includes(frequency)) {
      throw new ArgumentInvalidException(`Invalid frequency: ${String(frequency)}`);
    }

    switch (frequency) {
      case SupplyFrequency.DAILY: {
        // Daily lists carry no schedule rows.
        return new SupplyFrequencyVO(frequency, []);
      }
      case SupplyFrequency.WEEKLY: {
        const days = rules
          .map((r) => r.dayOfWeek)
          .filter((d): d is number => d !== null && d !== undefined);
        if (days.length === 0) {
          throw new ArgumentInvalidException('WEEKLY frequency requires at least one dayOfWeek');
        }
        for (const d of days) {
          if (!Number.isInteger(d) || d < 1 || d > 7) {
            throw new ArgumentInvalidException(`dayOfWeek must be between 1 and 7, got ${d}`);
          }
        }
        return new SupplyFrequencyVO(
          frequency,
          days.map((dayOfWeek) => ({ dayOfWeek }))
        );
      }
      case SupplyFrequency.MONTHLY: {
        const days = rules
          .map((r) => r.dayOfMonth)
          .filter((d): d is number => d !== null && d !== undefined);
        if (days.length === 0) {
          throw new ArgumentInvalidException('MONTHLY frequency requires at least one dayOfMonth');
        }
        for (const d of days) {
          if (!Number.isInteger(d) || d < 1 || d > 31) {
            throw new ArgumentInvalidException(`dayOfMonth must be between 1 and 31, got ${d}`);
          }
        }
        return new SupplyFrequencyVO(
          frequency,
          days.map((dayOfMonth) => ({ dayOfMonth }))
        );
      }
      default:
        return assertUnreachable(frequency);
    }
  }

  get frequency(): SupplyFrequency {
    return this._frequency;
  }

  get rules(): ScheduleRule[] {
    return [...this._rules];
  }

  equals(other?: SupplyFrequencyVO): boolean {
    if (!other) return false;
    if (this._frequency !== other._frequency) return false;
    if (this._rules.length !== other._rules.length) return false;
    const key = (r: ScheduleRule): string => `${r.dayOfWeek ?? ''}-${r.dayOfMonth ?? ''}`;
    const a = this._rules.map(key).sort();
    const b = other._rules.map(key).sort();
    return a.every((v, i) => v === b[i]);
  }
}

function assertUnreachable(value: never): never {
  throw new ArgumentInvalidException(`Unhandled frequency: ${String(value)}`);
}
