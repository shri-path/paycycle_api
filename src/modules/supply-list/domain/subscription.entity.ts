import { ArgumentInvalidException } from '@/common/errors/app-error';
import { MissingSubscriptionPricingError } from './supply-list.errors';
import {
  CreateSubscriptionProps,
  ListDefaults,
  ReconstituteSubscriptionData,
  SubscriptionProps,
} from './subscription.types';
import { Quantity } from './value-objects/quantity.value-object';
import { RateMoney } from './value-objects/rate-money.value-object';
import { DateRange } from './value-objects/date-range.value-object';
import { SubscriptionStatus } from './value-objects/subscription-status.value-object';
import { CustomerSubscribedEvent } from './events/customer-subscribed.domain-event';
import { SubscriptionUpdatedEvent } from './events/subscription-updated.domain-event';
import { SubscriptionEndedEvent } from './events/subscription-ended.domain-event';

type DomainEvent = CustomerSubscribedEvent | SubscriptionUpdatedEvent | SubscriptionEndedEvent;

/**
 * Aggregate root for a customer's subscription to a supply list.
 * Status is derived from `isActive` + `endDate` (no separate column).
 */
export class SubscriptionEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: SubscriptionProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: SubscriptionProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }

  get vendorId(): bigint {
    return this._props.vendorId;
  }

  get supplyListId(): bigint {
    return this._props.supplyListId;
  }

  get customerId(): bigint {
    return this._props.customerId;
  }

  get status(): SubscriptionStatus {
    return SubscriptionStatus.fromPersistence(this._props.isActive, this._props.endDate);
  }

  getProps(): Readonly<SubscriptionProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  getDomainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  /** Identity-based equality: two subscriptions are equal iff they share the same id. */
  equals(other?: SubscriptionEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  private addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  // === Factories ===

  static create(props: CreateSubscriptionProps): SubscriptionEntity {
    // Validate VOs.
    if (props.customQuantity !== null) Quantity.create(props.customQuantity);
    if (props.customRatePerUnit !== null) RateMoney.create(props.customRatePerUnit);
    DateRange.create(props.startDate, null);

    const entity = new SubscriptionEntity(0n, new Date(), new Date(), {
      vendorId: props.vendorId,
      supplyListId: props.supplyListId,
      customerId: props.customerId,
      customQuantity:
        props.customQuantity === null ? null : Quantity.create(props.customQuantity).value,
      customRatePerUnit:
        props.customRatePerUnit === null ? null : RateMoney.create(props.customRatePerUnit).amount,
      startDate: props.startDate,
      endDate: null,
      isActive: true,
      deletedAt: null,
    });
    entity.validate();
    entity.addDomainEvent(
      new CustomerSubscribedEvent(
        entity._id,
        props.vendorId,
        props.supplyListId,
        props.customerId,
        props.correlationId
      )
    );
    return entity;
  }

  static reconstitute(data: ReconstituteSubscriptionData): SubscriptionEntity {
    const entity = new SubscriptionEntity(data.id, data.createdAt, data.updatedAt, {
      ...data.props,
    });
    entity.validate();
    return entity;
  }

  // === Behaviors ===

  /**
   * Set or clear pricing overrides. Pass `undefined` to leave unchanged,
   * `null` to clear an override back to the list default.
   */
  updatePricing(
    quantity: number | null | undefined,
    rate: number | null | undefined,
    correlationId: string
  ): void {
    const changed: string[] = [];
    if (quantity !== undefined) {
      this._props.customQuantity = quantity === null ? null : Quantity.create(quantity).value;
      changed.push('customQuantity');
    }
    if (rate !== undefined) {
      this._props.customRatePerUnit = rate === null ? null : RateMoney.create(rate).amount;
      changed.push('customRatePerUnit');
    }
    if (changed.length > 0) {
      this._updatedAt = new Date();
      this.validate();
      this.addDomainEvent(
        new SubscriptionUpdatedEvent(this._id, this._props.vendorId, changed, correlationId)
      );
    }
  }

  pause(correlationId: string): void {
    this.status.assertTransition('PAUSED');
    this._props.isActive = false;
    this._updatedAt = new Date();
    this.addDomainEvent(
      new SubscriptionUpdatedEvent(this._id, this._props.vendorId, ['status'], correlationId)
    );
  }

  resume(correlationId: string): void {
    this.status.assertTransition('ACTIVE');
    this._props.isActive = true;
    this._updatedAt = new Date();
    this.addDomainEvent(
      new SubscriptionUpdatedEvent(this._id, this._props.vendorId, ['status'], correlationId)
    );
  }

  end(correlationId: string): void {
    this.status.assertTransition('ENDED');
    const today = new Date();
    this._props.endDate = today;
    this._props.isActive = false;
    this._updatedAt = today;
    this.addDomainEvent(
      new SubscriptionEndedEvent(
        this._id,
        this._props.vendorId,
        this._props.supplyListId,
        this._props.customerId,
        today,
        correlationId
      )
    );
  }

  // === Domain calculations (override-first) ===

  effectiveQuantity(defaults: ListDefaults): number {
    const value = this._props.customQuantity ?? defaults.defaultQuantity;
    if (value === null) {
      throw new MissingSubscriptionPricingError(
        'This list has no default quantity; provide a custom quantity for the customer'
      );
    }
    return value;
  }

  effectiveRate(defaults: ListDefaults): number {
    const value = this._props.customRatePerUnit ?? defaults.ratePerUnit;
    if (value === null) {
      throw new MissingSubscriptionPricingError(
        'This list has no default rate; provide a custom rate for the customer'
      );
    }
    return value;
  }

  amount(defaults: ListDefaults): number {
    const raw = this.effectiveQuantity(defaults) * this.effectiveRate(defaults);
    return Math.round(raw * 100) / 100;
  }

  isCustomQuantity(): boolean {
    return this._props.customQuantity !== null;
  }

  isCustomRate(): boolean {
    return this._props.customRatePerUnit !== null;
  }

  // === Invariants ===

  private validate(): void {
    if (this._props.customQuantity !== null && this._props.customQuantity < 0) {
      throw new ArgumentInvalidException('customQuantity must be >= 0');
    }
    if (this._props.customRatePerUnit !== null && this._props.customRatePerUnit < 0) {
      throw new ArgumentInvalidException('customRatePerUnit must be >= 0');
    }
    DateRange.create(this._props.startDate, this._props.endDate);
  }
}
