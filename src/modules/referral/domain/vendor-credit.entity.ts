/**
 * VendorCredit Aggregate Root — balance + ledger invariants.
 * No framework imports.
 */
import { BadRequestError } from '@/common/errors/app-error';
import { VendorCreditProps } from './vendor-referral.types';

export interface VendorCreditEntityProps {
  id: bigint;
  props: VendorCreditProps;
  createdAt?: Date;
  updatedAt?: Date;
}

export class VendorCreditEntity {
  protected readonly props: VendorCreditProps;
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor({ id, props, createdAt, updatedAt }: VendorCreditEntityProps) {
    this._id = id;
    this.props = { ...props };
    this._createdAt = createdAt ?? new Date();
    this._updatedAt = updatedAt ?? new Date();
    this.validate();
  }

  static create(vendorId: bigint): VendorCreditEntity {
    return new VendorCreditEntity({
      id: BigInt(0),
      props: { vendorId, availableCredits: 0, lifetimeCreditsEarned: 0, lifetimeCreditsUsed: 0 },
    });
  }

  static fromPersistence(entityProps: VendorCreditEntityProps): VendorCreditEntity {
    return new VendorCreditEntity(entityProps);
  }

  get id(): bigint {
    return this._id;
  }
  get vendorId(): bigint {
    return this.props.vendorId;
  }
  get availableCredits(): number {
    return this.props.availableCredits;
  }
  get lifetimeCreditsEarned(): number {
    return this.props.lifetimeCreditsEarned;
  }
  get lifetimeCreditsUsed(): number {
    return this.props.lifetimeCreditsUsed;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  getProps(): VendorCreditProps & { id: bigint; createdAt: Date; updatedAt: Date } {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this.props,
    });
  }

  /** Guard: available credits must never go negative. */
  private validate(): void {
    if (this.props.availableCredits < 0) {
      throw new BadRequestError('Available credits cannot be negative');
    }
  }

  /** Earn credits — increases available + lifetime earned. */
  earn(amount: number): void {
    if (amount <= 0) throw new BadRequestError('Earn amount must be positive');
    this.props.availableCredits = Math.round((this.props.availableCredits + amount) * 100) / 100;
    this.props.lifetimeCreditsEarned =
      Math.round((this.props.lifetimeCreditsEarned + amount) * 100) / 100;
    this._updatedAt = new Date();
  }

  /** Use credits — decreases available + increases lifetime used. */
  use(amount: number): void {
    if (amount <= 0) throw new BadRequestError('Use amount must be positive');
    if (amount > this.props.availableCredits) {
      throw new BadRequestError(
        `Insufficient credits. Available: ₹${this.props.availableCredits}, Requested: ₹${amount}`
      );
    }
    this.props.availableCredits = Math.round((this.props.availableCredits - amount) * 100) / 100;
    this.props.lifetimeCreditsUsed =
      Math.round((this.props.lifetimeCreditsUsed + amount) * 100) / 100;
    this._updatedAt = new Date();
  }

  /** Adjustment (clawback) — decreases available credits. Amount must be positive (magnitude). */
  adjust(amount: number): void {
    if (amount <= 0) throw new BadRequestError('Adjustment amount must be positive');
    const newBalance = Math.round((this.props.availableCredits - amount) * 100) / 100;
    if (newBalance < 0) {
      // Clamp to zero — can't go below zero
      this.props.lifetimeCreditsUsed =
        Math.round((this.props.lifetimeCreditsUsed + this.props.availableCredits) * 100) / 100;
      this.props.availableCredits = 0;
    } else {
      this.props.availableCredits = newBalance;
      this.props.lifetimeCreditsUsed =
        Math.round((this.props.lifetimeCreditsUsed + amount) * 100) / 100;
    }
    this._updatedAt = new Date();
  }
}
