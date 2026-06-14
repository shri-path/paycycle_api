/**
 * AgingBucket — pure classifier VO. No persistence.
 * Classifies a customer's outstanding balance by days overdue.
 */

export enum AgingBucketEnum {
  FRESH_0_30 = 'FRESH_0_30',
  OVERDUE_30_60 = 'OVERDUE_30_60',
  CRITICAL_60_PLUS = 'CRITICAL_60_PLUS',
}

export class AgingBucketVO {
  private readonly _bucket: AgingBucketEnum;
  readonly daysOverdue: number;

  private constructor(bucket: AgingBucketEnum, daysOverdue: number) {
    this._bucket = bucket;
    this.daysOverdue = daysOverdue;
  }

  /**
   * Classify days overdue into a bucket.
   * Days are clamped at 0 (never negative).
   */
  static fromDaysOverdue(days: number): AgingBucketVO {
    const clamped = Math.max(0, Math.floor(days));
    let bucket: AgingBucketEnum;
    if (clamped <= 30) {
      bucket = AgingBucketEnum.FRESH_0_30;
    } else if (clamped <= 60) {
      bucket = AgingBucketEnum.OVERDUE_30_60;
    } else {
      bucket = AgingBucketEnum.CRITICAL_60_PLUS;
    }
    return new AgingBucketVO(bucket, clamped);
  }

  unpack(): AgingBucketEnum {
    return this._bucket;
  }

  equals(other: AgingBucketVO): boolean {
    return this._bucket === other._bucket && this.daysOverdue === other.daysOverdue;
  }
}
