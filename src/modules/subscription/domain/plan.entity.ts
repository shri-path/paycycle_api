/**
 * SubscriptionPlanEntity — aggregate root for the SubscriptionPlan bounded context.
 * Reference data; no mutators. Framework-free.
 */
import { PlanTierVO } from './value-objects/plan-tier.vo';
import { PlanLimitsVO } from './value-objects/plan-limits.vo';
import { MoneyVO } from './value-objects/money.vo';
import { SubscriptionPlanProps } from './subscription.types';

export class SubscriptionPlanEntity {
  private constructor(
    private readonly _id: bigint,
    private readonly _props: SubscriptionPlanProps,
    private readonly _tier: PlanTierVO,
    private readonly _limits: PlanLimitsVO,
    private readonly _priceMonthlyVO: MoneyVO,
    private readonly _priceYearlyVO: MoneyVO | null
  ) {}

  static fromPersistence(row: {
    id: bigint;
    planName: string;
    planCode: string;
    priceMonthly: number;
    priceYearly: number | null;
    maxCustomers: number;
    maxStaff: number;
    maxSupplyLists: number;
    features: Record<string, boolean> | null;
    isActive: boolean;
  }): SubscriptionPlanEntity {
    const tier = PlanTierVO.fromCode(row.planCode);
    const limits = PlanLimitsVO.create(row.maxCustomers, row.maxStaff, row.maxSupplyLists);
    const priceMonthly = MoneyVO.of(row.priceMonthly);
    const priceYearly = row.priceYearly !== null ? MoneyVO.of(row.priceYearly) : null;

    return new SubscriptionPlanEntity(
      row.id,
      {
        planName: row.planName,
        planCode: row.planCode,
        priceMonthly: priceMonthly.amount,
        priceYearly: priceYearly?.amount ?? null,
        maxCustomers: row.maxCustomers,
        maxStaff: row.maxStaff,
        maxSupplyLists: row.maxSupplyLists,
        features: row.features,
        isActive: row.isActive,
      },
      tier,
      limits,
      priceMonthly,
      priceYearly
    );
  }

  get id(): bigint {
    return this._id;
  }

  get planName(): string {
    return this._props.planName;
  }

  get planCode(): string {
    return this._props.planCode;
  }

  get tier(): PlanTierVO {
    return this._tier;
  }

  get limits(): PlanLimitsVO {
    return this._limits;
  }

  get priceMonthly(): MoneyVO {
    return this._priceMonthlyVO;
  }

  get priceYearly(): MoneyVO | null {
    return this._priceYearlyVO;
  }

  get features(): Record<string, boolean> | null {
    return this._props.features;
  }

  get isActive(): boolean {
    return this._props.isActive;
  }

  /** Price for the given billing cycle as a number (INR). */
  priceForCycle(cycleDays: number): number {
    if (cycleDays === 365 && this._priceYearlyVO !== null) {
      return this._priceYearlyVO.amount;
    }
    return this._priceMonthlyVO.amount;
  }
}
