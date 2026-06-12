/**
 * VendorSubscriptionEntity — aggregate root for the Platform Subscription context.
 * State machine: ACTIVE ↔ CANCELLED / EXPIRED.
 * Framework-free: no Prisma, Express, or Pino imports.
 */
import { BillingCycleVO } from './value-objects/billing-cycle.vo';
import { MoneyVO } from './value-objects/money.vo';
import { PlanTierVO } from './value-objects/plan-tier.vo';
import {
  VendorSubscriptionStatus,
  BillingCycleEnum,
  VendorSubscriptionProps,
} from './subscription.types';
import { InvalidPlanUpgradeError, SubscriptionAlreadyCancelledError } from './subscription.errors';
import { SubscriptionPlanEntity } from './plan.entity';
import { SubscriptionCreatedEvent } from './events/subscription-created.domain-event';
import { SubscriptionUpgradedEvent } from './events/subscription-upgraded.domain-event';
import { SubscriptionRenewedEvent } from './events/subscription-renewed.domain-event';
import { SubscriptionCancelledEvent } from './events/subscription-cancelled.domain-event';
import { SubscriptionExpiredEvent } from './events/subscription-expired.domain-event';

type DomainEvent =
  | SubscriptionCreatedEvent
  | SubscriptionUpgradedEvent
  | SubscriptionRenewedEvent
  | SubscriptionCancelledEvent
  | SubscriptionExpiredEvent;

export class VendorSubscriptionEntity {
  private _events: DomainEvent[] = [];

  private constructor(
    private _id: bigint,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
    private _props: VendorSubscriptionProps
  ) {}

  // ── Getters ───────────────────────────────────────────────────────────────

  get id(): bigint {
    return this._id;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get vendorId(): bigint {
    return this._props.vendorId;
  }

  get subscriptionPlanId(): bigint {
    return this._props.subscriptionPlanId;
  }

  get billingCycle(): BillingCycleVO {
    return BillingCycleVO.of(this._props.billingCycle);
  }

  get startDate(): Date {
    return this._props.startDate;
  }

  get endDate(): Date | null {
    return this._props.endDate;
  }

  get nextBillingDate(): Date | null {
    return this._props.nextBillingDate;
  }

  get status(): VendorSubscriptionStatus {
    return this._props.status;
  }

  get amountPaid(): MoneyVO {
    return MoneyVO.of(this._props.amountPaid);
  }

  get autoRenewal(): boolean {
    return this._props.autoRenewal;
  }

  get isTrial(): boolean {
    return this._props.isTrial;
  }

  get trialEndsAt(): Date | null {
    return this._props.trialEndsAt;
  }

  getProps(): Readonly<VendorSubscriptionProps> {
    return Object.freeze({ ...this._props });
  }

  pullEvents(): DomainEvent[] {
    const events = [...this._events];
    this._events = [];
    return events;
  }

  // ── Factory: create Starter subscription ─────────────────────────────────

  static createStarter(
    vendorId: bigint,
    plan: SubscriptionPlanEntity,
    today: Date
  ): VendorSubscriptionEntity {
    const nextBilling = new Date(today);
    nextBilling.setDate(nextBilling.getDate() + 30);

    const entity = new VendorSubscriptionEntity(0n, today, today, {
      vendorId,
      subscriptionPlanId: plan.id,
      billingCycle: BillingCycleEnum.MONTHLY,
      startDate: today,
      endDate: null,
      nextBillingDate: nextBilling,
      status: VendorSubscriptionStatus.ACTIVE,
      amountPaid: 0,
      autoRenewal: true,
      isTrial: false,
      trialEndsAt: null,
    });

    entity._events.push(
      new SubscriptionCreatedEvent({
        vendorSubscriptionId: entity._id,
        vendorId,
        newPlanId: plan.id,
        performedByUserId: null,
        occurredAt: today,
      })
    );

    return entity;
  }

  // ── Factory: reconstitute from persistence ───────────────────────────────

  static reconstitute(
    id: bigint,
    createdAt: Date,
    updatedAt: Date,
    props: VendorSubscriptionProps
  ): VendorSubscriptionEntity {
    return new VendorSubscriptionEntity(id, createdAt, updatedAt, props);
  }

  // ── Assign a persisted ID (called after DB insert) ───────────────────────

  assignId(id: bigint): void {
    this._id = id;
  }

  // ── Behaviour: upgrade (returns the new entity; caller handles old close) ─

  /**
   * Close the current subscription for upgrade.
   * Sets endDate=today, status=CANCELLED.
   * Returns this entity mutated for persistence.
   */
  closeForUpgrade(today: Date): this {
    this._props = {
      ...this._props,
      endDate: today,
      status: VendorSubscriptionStatus.CANCELLED,
    };
    this._updatedAt = today;
    return this;
  }

  /**
   * Create a new ACTIVE subscription for the upgraded plan.
   * Emits SubscriptionUpgradedEvent.
   */
  static upgradeTo(
    currentEntity: VendorSubscriptionEntity,
    newPlan: SubscriptionPlanEntity,
    currentPlanTier: PlanTierVO,
    billingCycle: BillingCycleEnum,
    today: Date,
    prorataAmount: number,
    performedByUserId?: bigint | null
  ): VendorSubscriptionEntity {
    const newTier = newPlan.tier;
    if (!newTier.isHigherThan(currentPlanTier)) {
      throw new InvalidPlanUpgradeError(
        `Target plan must be a strictly higher tier than the current plan`
      );
    }

    const cycle = BillingCycleVO.of(billingCycle);
    const nextBilling = new Date(today);
    nextBilling.setDate(nextBilling.getDate() + cycle.days());

    const newEntity = new VendorSubscriptionEntity(0n, today, today, {
      vendorId: currentEntity.vendorId,
      subscriptionPlanId: newPlan.id,
      billingCycle,
      startDate: today,
      endDate: null,
      nextBillingDate: nextBilling,
      status: VendorSubscriptionStatus.ACTIVE,
      amountPaid: prorataAmount,
      autoRenewal: currentEntity.autoRenewal,
      isTrial: false,
      trialEndsAt: null,
    });

    newEntity._events.push(
      new SubscriptionUpgradedEvent({
        vendorSubscriptionId: newEntity._id,
        vendorId: currentEntity.vendorId,
        oldPlanId: currentEntity.subscriptionPlanId,
        newPlanId: newPlan.id,
        performedByUserId: performedByUserId ?? null,
        occurredAt: today,
      })
    );

    return newEntity;
  }

  // ── Behaviour: renew ─────────────────────────────────────────────────────

  renew(
    billingCycle: BillingCycleEnum,
    today: Date,
    amount: number,
    performedByUserId?: bigint | null
  ): void {
    const cycle = BillingCycleVO.of(billingCycle);
    const prevEnd = this._props.nextBillingDate ?? today;
    const start = prevEnd > today ? prevEnd : today;
    const nextBilling = new Date(start);
    nextBilling.setDate(nextBilling.getDate() + cycle.days());

    this._props = {
      ...this._props,
      billingCycle,
      startDate: start,
      endDate: null,
      nextBillingDate: nextBilling,
      status: VendorSubscriptionStatus.ACTIVE,
      amountPaid: MoneyVO.of(amount).amount,
    };
    this._updatedAt = today;

    this._events.push(
      new SubscriptionRenewedEvent({
        vendorSubscriptionId: this._id,
        vendorId: this._props.vendorId,
        planId: this._props.subscriptionPlanId,
        performedByUserId: performedByUserId ?? null,
        occurredAt: today,
      })
    );
  }

  // ── Behaviour: cancel ────────────────────────────────────────────────────

  cancel(today: Date, performedByUserId?: bigint | null): void {
    if (
      this._props.status === VendorSubscriptionStatus.CANCELLED ||
      this._props.status === VendorSubscriptionStatus.EXPIRED
    ) {
      throw new SubscriptionAlreadyCancelledError();
    }

    this._props = {
      ...this._props,
      status: VendorSubscriptionStatus.CANCELLED,
      autoRenewal: false,
    };
    this._updatedAt = today;

    this._events.push(
      new SubscriptionCancelledEvent({
        vendorSubscriptionId: this._id,
        vendorId: this._props.vendorId,
        planId: this._props.subscriptionPlanId,
        performedByUserId: performedByUserId ?? null,
        occurredAt: today,
      })
    );
  }

  // ── Behaviour: expire ────────────────────────────────────────────────────

  expire(today: Date): void {
    if (this._props.status === VendorSubscriptionStatus.EXPIRED) return; // idempotent

    this._props = {
      ...this._props,
      status: VendorSubscriptionStatus.EXPIRED,
      endDate: today,
    };
    this._updatedAt = today;

    this._events.push(
      new SubscriptionExpiredEvent({
        vendorSubscriptionId: this._id,
        vendorId: this._props.vendorId,
        planId: this._props.subscriptionPlanId,
        occurredAt: today,
      })
    );
  }

  // ── Behaviour: toggle auto-renewal ───────────────────────────────────────

  setAutoRenewal(flag: boolean): void {
    this._props = { ...this._props, autoRenewal: flag };
    this._updatedAt = new Date();
  }
}
