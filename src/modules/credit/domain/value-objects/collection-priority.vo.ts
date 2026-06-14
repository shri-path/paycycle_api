/**
 * CollectionPriority — pure classifier VO. No persistence.
 * Derives collection priority from days overdue + utilization.
 */

export enum CollectionPriorityEnum {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export class CollectionPriorityVO {
  private readonly _priority: CollectionPriorityEnum;

  private constructor(priority: CollectionPriorityEnum) {
    this._priority = priority;
  }

  /**
   * Evaluate priority:
   * HIGH if daysOverdue > 60 OR utilization >= 95
   * MEDIUM if daysOverdue > 30 OR utilization >= 80
   * else LOW
   */
  static evaluate(daysOverdue: number, utilizationPercent: number): CollectionPriorityVO {
    let priority: CollectionPriorityEnum;
    if (daysOverdue > 60 || utilizationPercent >= 95) {
      priority = CollectionPriorityEnum.HIGH;
    } else if (daysOverdue > 30 || utilizationPercent >= 80) {
      priority = CollectionPriorityEnum.MEDIUM;
    } else {
      priority = CollectionPriorityEnum.LOW;
    }
    return new CollectionPriorityVO(priority);
  }

  unpack(): CollectionPriorityEnum {
    return this._priority;
  }

  equals(other: CollectionPriorityVO): boolean {
    return this._priority === other._priority;
  }
}
