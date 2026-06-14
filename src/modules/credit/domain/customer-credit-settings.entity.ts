/**
 * CustomerCreditSettingsEntity — aggregate root.
 * No framework imports (no Prisma, Express, Pino).
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { CreditTypeVO } from './value-objects/credit-type.vo';
import { WarningThresholdVO } from './value-objects/warning-threshold.vo';
import { BreachActionVO } from './value-objects/breach-action.vo';
import {
  CustomerCreditSettingsProps,
  CreateCreditSettingsProps,
  SetCreditSettingsPatch,
  CreditTypeEnum,
  CreditBreachActionEnum,
  BreachEvaluationResult,
} from './credit.types';

export class CustomerCreditSettingsEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: CustomerCreditSettingsProps;

  private constructor(
    id: bigint,
    createdAt: Date,
    updatedAt: Date,
    props: CustomerCreditSettingsProps
  ) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  getProps(): Readonly<
    CustomerCreditSettingsProps & { id: bigint; createdAt: Date; updatedAt: Date }
  > {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  equals(other?: CustomerCreditSettingsEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  // ── Factory: create new settings ──────────────────────────────────────────

  static create(input: CreateCreditSettingsProps): CustomerCreditSettingsEntity {
    const creditType = input.creditType ?? CreditTypeEnum.NORMAL;
    const warningThresholdPercent = input.warningThresholdPercent ?? 90;
    const actionOnBreach = input.actionOnBreach ?? CreditBreachActionEnum.WARN;

    // Apply invariant 4 at creation: UNLIMITED forces WARN
    const resolvedAction =
      creditType === CreditTypeEnum.UNLIMITED ? CreditBreachActionEnum.WARN : actionOnBreach;

    const entity = new CustomerCreditSettingsEntity(0n, new Date(), new Date(), {
      customerId: input.customerId,
      creditType,
      warningThresholdPercent,
      actionOnBreach: resolvedAction,
      minimumBalanceWarning: input.minimumBalanceWarning ?? null,
    });
    entity.validate();
    return entity;
  }

  // ── Factory: reconstitute from persistence ────────────────────────────────

  static reconstitute(data: {
    id: bigint;
    createdAt: Date;
    updatedAt: Date;
    props: CustomerCreditSettingsProps;
  }): CustomerCreditSettingsEntity {
    const entity = new CustomerCreditSettingsEntity(
      data.id,
      data.createdAt,
      data.updatedAt,
      data.props
    );
    entity.validate();
    return entity;
  }

  // ── Domain behaviour ──────────────────────────────────────────────────────

  setPolicy(patch: SetCreditSettingsPatch): void {
    const updated = { ...this._props };

    if (patch.creditType !== undefined) {
      updated.creditType = patch.creditType;
    }
    if (patch.warningThresholdPercent !== undefined) {
      updated.warningThresholdPercent = patch.warningThresholdPercent;
    }
    if (patch.actionOnBreach !== undefined) {
      updated.actionOnBreach = patch.actionOnBreach;
    }
    if (patch.minimumBalanceWarning !== undefined) {
      updated.minimumBalanceWarning = patch.minimumBalanceWarning;
    }

    // Invariant 4: UNLIMITED forces WARN
    if (updated.creditType === CreditTypeEnum.UNLIMITED) {
      updated.actionOnBreach = CreditBreachActionEnum.WARN;
    }

    this._props = updated;
    this._updatedAt = new Date();
    this.validate();
  }

  enablePrepaid(minimumBalanceWarning: number | null): void {
    this._props = {
      ...this._props,
      creditType: CreditTypeEnum.PREPAID,
      minimumBalanceWarning,
    };
    this._updatedAt = new Date();
    this.validate();
  }

  /**
   * Pure domain method: evaluate breach status given the current balance and limit.
   * Does NOT mutate state — callers react to the result.
   */
  evaluateBreach(balance: number, creditLimit: number): BreachEvaluationResult {
    // UNLIMITED never breaches
    if (this._props.creditType === CreditTypeEnum.UNLIMITED) {
      return { breached: false, nearLimit: false, utilizationPercent: 0 };
    }

    const utilizationPercent = creditLimit > 0 ? Math.round((balance / creditLimit) * 100) : 0;
    const breached = balance > creditLimit;
    const nearLimit = utilizationPercent >= this._props.warningThresholdPercent;

    return { breached, nearLimit, utilizationPercent };
  }

  // ── Invariants ────────────────────────────────────────────────────────────

  private validate(): void {
    // Validate via VOs (throws ArgumentInvalidException on violation)
    CreditTypeVO.create(this._props.creditType);
    WarningThresholdVO.create(this._props.warningThresholdPercent);
    BreachActionVO.create(this._props.actionOnBreach);

    // Invariant 4: UNLIMITED must use WARN
    if (
      this._props.creditType === CreditTypeEnum.UNLIMITED &&
      this._props.actionOnBreach !== CreditBreachActionEnum.WARN
    ) {
      throw new ArgumentInvalidException(
        'UNLIMITED credit type must use WARN action on breach (limit is never enforced)'
      );
    }

    // Invariant 5: PREPAID requires minimumBalanceWarning >= 0 (when provided)
    if (
      this._props.creditType === CreditTypeEnum.PREPAID &&
      this._props.minimumBalanceWarning !== null &&
      this._props.minimumBalanceWarning !== undefined &&
      this._props.minimumBalanceWarning < 0
    ) {
      throw new ArgumentInvalidException(
        'minimumBalanceWarning must be >= 0 for PREPAID credit type'
      );
    }
  }
}
