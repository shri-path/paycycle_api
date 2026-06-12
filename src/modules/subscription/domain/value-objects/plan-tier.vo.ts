/**
 * PlanTier value object.
 * STARTER(0) < GROWTH(1) < PRO(2)
 * Derived from plan_code.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';

export enum PlanTierEnum {
  STARTER = 'STARTER',
  GROWTH = 'GROWTH',
  PRO = 'PRO',
}

export class PlanTierVO {
  private constructor(private readonly _value: PlanTierEnum) {}

  static fromCode(planCode: string): PlanTierVO {
    const code = planCode.toUpperCase() as PlanTierEnum;
    if (Object.values(PlanTierEnum).includes(code)) {
      return new PlanTierVO(code);
    }
    throw new ArgumentInvalidException(`Invalid plan code: ${planCode}`);
  }

  static of(tier: PlanTierEnum): PlanTierVO {
    return new PlanTierVO(tier);
  }

  rank(): number {
    switch (this._value) {
      case PlanTierEnum.STARTER:
        return 0;
      case PlanTierEnum.GROWTH:
        return 1;
      case PlanTierEnum.PRO:
        return 2;
    }
  }

  isHigherThan(other: PlanTierVO): boolean {
    return this.rank() > other.rank();
  }

  get value(): PlanTierEnum {
    return this._value;
  }

  equals(other: PlanTierVO): boolean {
    return this._value === other._value;
  }
}
