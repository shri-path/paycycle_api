/**
 * ConfidenceScoreVO — 0-100 numeric confidence level, 2dp.
 * Pure domain, no framework imports.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';

const AUTO_EXECUTE_THRESHOLD = 80;

export class ConfidenceScoreVO {
  readonly value: number;

  private constructor(value: number) {
    this.value = value;
  }

  static create(raw: number): ConfidenceScoreVO {
    if (typeof raw !== 'number' || isNaN(raw)) {
      throw new ArgumentInvalidException('Confidence score must be a number');
    }
    if (raw < 0 || raw > 100) {
      throw new ArgumentInvalidException(`Confidence score must be between 0 and 100 (got ${raw})`);
    }
    const rounded = Math.round(raw * 100) / 100;
    return new ConfidenceScoreVO(rounded);
  }

  /** Returns true when auto-execution is recommended. */
  isAutoExecutable(threshold = AUTO_EXECUTE_THRESHOLD): boolean {
    return this.value > threshold;
  }

  equals(other: ConfidenceScoreVO): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value.toString();
  }
}
