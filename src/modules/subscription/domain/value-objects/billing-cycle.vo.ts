/**
 * BillingCycle value object.
 * MONTHLY = 30 days, YEARLY = 365 days.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { BillingCycleEnum } from '../subscription.types';

export class BillingCycleVO {
  private constructor(private readonly _value: BillingCycleEnum) {}

  static of(value: BillingCycleEnum): BillingCycleVO {
    return new BillingCycleVO(value);
  }

  static fromString(raw: string): BillingCycleVO {
    const upper = raw.toUpperCase() as BillingCycleEnum;
    if (Object.values(BillingCycleEnum).includes(upper)) {
      return new BillingCycleVO(upper);
    }
    throw new ArgumentInvalidException(`Invalid billing cycle: ${raw}`);
  }

  days(): number {
    return this._value === BillingCycleEnum.MONTHLY ? 30 : 365;
  }

  get value(): BillingCycleEnum {
    return this._value;
  }

  equals(other: BillingCycleVO): boolean {
    return this._value === other._value;
  }
}
