/**
 * VendorReferral Aggregate Root.
 * No framework imports — pure domain logic.
 */
import { BadRequestError, ForbiddenError } from '@/common/errors/app-error';
import {
  VendorReferralProps,
  CreateVendorReferralProps,
  ReferralVendorStatus,
  VendorRewardType,
  REWARD_AMOUNTS,
} from './vendor-referral.types';

const VALID_TRANSITIONS: Record<ReferralVendorStatus, ReferralVendorStatus[]> = {
  [ReferralVendorStatus.PENDING]: [ReferralVendorStatus.SIGNED_UP],
  [ReferralVendorStatus.SIGNED_UP]: [ReferralVendorStatus.QUALIFIED],
  [ReferralVendorStatus.QUALIFIED]: [ReferralVendorStatus.REWARDED],
  [ReferralVendorStatus.REWARDED]: [],
};

export interface BaseEntityProps {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateEntityProps<T> {
  id: bigint;
  props: T;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export class VendorReferral {
  protected readonly props: VendorReferralProps;
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private readonly _deletedAt: Date | null;

  private constructor({
    id,
    props,
    createdAt,
    updatedAt,
    deletedAt,
  }: CreateEntityProps<VendorReferralProps>) {
    this._id = id;
    this.props = props;
    this._createdAt = createdAt ?? new Date();
    this._updatedAt = updatedAt ?? new Date();
    this._deletedAt = deletedAt ?? null;
  }

  static create(create: CreateVendorReferralProps): VendorReferral {
    const props: VendorReferralProps = {
      referrerVendorId: create.referrerVendorId,
      refereeVendorId: null,
      referralCode: create.referralCode,
      status: ReferralVendorStatus.PENDING,
      rewardType: create.rewardType ?? VendorRewardType.CASH_CREDIT,
      rewardAmount: create.rewardAmount ?? REWARD_AMOUNTS.SIGNUP_BONUS,
      refereeName: create.refereeName,
      refereePhone: create.refereePhone,
      signupDate: null,
      firstCustomerDate: null,
      milestone10At: null,
      milestone50At: null,
      revenueShareUntil: null,
      clawedBackAt: null,
    };
    return new VendorReferral({ id: BigInt(0), props });
  }

  static fromPersistence(entityProps: CreateEntityProps<VendorReferralProps>): VendorReferral {
    return new VendorReferral(entityProps);
  }

  get id(): bigint {
    return this._id;
  }
  get referrerVendorId(): bigint {
    return this.props.referrerVendorId;
  }
  get refereeVendorId(): bigint | null {
    return this.props.refereeVendorId;
  }
  get referralCode(): string {
    return this.props.referralCode;
  }
  get status(): ReferralVendorStatus {
    return this.props.status;
  }
  get rewardType(): VendorRewardType | null {
    return this.props.rewardType;
  }
  get rewardAmount(): number | null {
    return this.props.rewardAmount;
  }
  get refereeName(): string | null {
    return this.props.refereeName;
  }
  get refereePhone(): string | null {
    return this.props.refereePhone;
  }
  get signupDate(): Date | null {
    return this.props.signupDate;
  }
  get firstCustomerDate(): Date | null {
    return this.props.firstCustomerDate;
  }
  get milestone10At(): Date | null {
    return this.props.milestone10At;
  }
  get milestone50At(): Date | null {
    return this.props.milestone50At;
  }
  get revenueShareUntil(): Date | null {
    return this.props.revenueShareUntil;
  }
  get clawedBackAt(): Date | null {
    return this.props.clawedBackAt;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  get deletedAt(): Date | null {
    return this._deletedAt;
  }

  getProps(): VendorReferralProps & BaseEntityProps {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      deletedAt: this._deletedAt,
      ...this.props,
    });
  }

  equals(other?: VendorReferral): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  /** Transition referral status forward. Clawback does NOT change status. */
  private transitionTo(newStatus: ReferralVendorStatus): void {
    const allowed = VALID_TRANSITIONS[this.props.status];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestError(
        `Cannot transition referral from '${this.props.status}' to '${newStatus}'. Allowed: ${allowed.join(', ') || 'none (terminal)'}`
      );
    }
    this.props.status = newStatus;
    this._updatedAt = new Date();
  }

  /**
   * Attribute a referee signup to this referral.
   * Transitions PENDING → SIGNED_UP, sets signupDate and revenueShareUntil.
   */
  attributeSignup(refereeVendorId: bigint): void {
    if (refereeVendorId === this.props.referrerVendorId) {
      throw new ForbiddenError('Self-referral is not allowed');
    }
    this.transitionTo(ReferralVendorStatus.SIGNED_UP);
    this.props.refereeVendorId = refereeVendorId;
    const now = new Date();
    this.props.signupDate = now;
    // Revenue share window: 6 months from signup
    const revenueShareUntil = new Date(now);
    revenueShareUntil.setMonth(revenueShareUntil.getMonth() + REWARD_AMOUNTS.REVENUE_SHARE_MONTHS);
    this.props.revenueShareUntil = revenueShareUntil;
    this._updatedAt = new Date();
  }

  /** Qualify referral (SIGNED_UP → QUALIFIED) when referee reaches ≥3 customers in 30d. */
  qualify(): void {
    this.transitionTo(ReferralVendorStatus.QUALIFIED);
  }

  /** Mark as REWARDED (QUALIFIED → REWARDED). */
  markRewarded(): void {
    this.transitionTo(ReferralVendorStatus.REWARDED);
  }

  /** Record milestone 10 customers (idempotent guard: milestone10At). */
  recordMilestone10(): void {
    if (this.props.milestone10At !== null) {
      throw new BadRequestError('Milestone 10 already awarded');
    }
    if (this.props.clawedBackAt !== null) {
      throw new BadRequestError('Cannot award milestone — referral was clawed back');
    }
    this.props.milestone10At = new Date();
    this._updatedAt = new Date();
  }

  /** Record milestone 50 customers (idempotent guard: milestone50At). */
  recordMilestone50(): void {
    if (this.props.milestone50At !== null) {
      throw new BadRequestError('Milestone 50 already awarded');
    }
    if (this.props.clawedBackAt !== null) {
      throw new BadRequestError('Cannot award milestone — referral was clawed back');
    }
    this.props.milestone50At = new Date();
    this._updatedAt = new Date();
  }

  /** Clawback: mark clawedBackAt. Status stays unchanged; ledger reversal is handled separately. */
  markClawedBack(): void {
    if (this.props.clawedBackAt !== null) {
      throw new BadRequestError('Referral already clawed back');
    }
    this.props.clawedBackAt = new Date();
    this._updatedAt = new Date();
  }

  /** Whether this referral is within the 6-month revenue share window. */
  isInRevenueShareWindow(forDate: Date = new Date()): boolean {
    if (!this.props.revenueShareUntil) return false;
    return forDate <= this.props.revenueShareUntil;
  }

  /** Whether clawback window (60 days from signup) is still open. */
  isInClawbackWindow(forDate: Date = new Date()): boolean {
    if (!this.props.signupDate) return false;
    const windowEnd = new Date(this.props.signupDate);
    windowEnd.setDate(windowEnd.getDate() + REWARD_AMOUNTS.CLAWBACK_DAYS);
    return forDate <= windowEnd;
  }
}
