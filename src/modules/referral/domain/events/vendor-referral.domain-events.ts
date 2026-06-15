/**
 * Domain events for the Referral module.
 * No framework imports.
 */
import { randomUUID } from 'crypto';

type DomainEventMetadata = {
  readonly timestamp: number;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly userId?: string;
};

export type DomainEventProps<T> = Omit<T, 'id' | 'metadata'> & {
  aggregateId: string;
  metadata?: Partial<DomainEventMetadata>;
};

export abstract class DomainEvent {
  public readonly id: string;
  public readonly aggregateId: string;
  public readonly metadata: DomainEventMetadata;

  constructor(props: DomainEventProps<unknown>) {
    this.id = randomUUID();
    this.aggregateId = (props as { aggregateId: string }).aggregateId;
    const meta = (props as { metadata?: Partial<DomainEventMetadata> }).metadata;
    this.metadata = {
      correlationId: meta?.correlationId ?? randomUUID(),
      timestamp: meta?.timestamp ?? Date.now(),
      ...(meta?.causationId !== undefined ? { causationId: meta.causationId } : {}),
      ...(meta?.userId !== undefined ? { userId: meta.userId } : {}),
    } as DomainEventMetadata;
  }
}

export class VendorReferralCreatedEvent extends DomainEvent {
  readonly referrerVendorId: string;
  readonly referralCode: string;
  readonly refereePhone: string | null;

  constructor(props: DomainEventProps<VendorReferralCreatedEvent>) {
    super(props);
    this.referrerVendorId = props.referrerVendorId;
    this.referralCode = props.referralCode;
    this.refereePhone = props.refereePhone;
  }
}

export class VendorReferralSignedUpEvent extends DomainEvent {
  readonly referrerVendorId: string;
  readonly refereeVendorId: string;
  readonly referralCode: string;

  constructor(props: DomainEventProps<VendorReferralSignedUpEvent>) {
    super(props);
    this.referrerVendorId = props.referrerVendorId;
    this.refereeVendorId = props.refereeVendorId;
    this.referralCode = props.referralCode;
  }
}

export class VendorReferralQualifiedEvent extends DomainEvent {
  readonly referrerVendorId: string;
  readonly refereeVendorId: string;

  constructor(props: DomainEventProps<VendorReferralQualifiedEvent>) {
    super(props);
    this.referrerVendorId = props.referrerVendorId;
    this.refereeVendorId = props.refereeVendorId;
  }
}

export class ReferralRewardEarnedEvent extends DomainEvent {
  readonly vendorId: string;
  readonly amount: number;
  readonly rewardKind: string;

  constructor(props: DomainEventProps<ReferralRewardEarnedEvent>) {
    super(props);
    this.vendorId = props.vendorId;
    this.amount = props.amount;
    this.rewardKind = props.rewardKind;
  }
}

export class ReferralRewardClawedBackEvent extends DomainEvent {
  readonly vendorId: string;
  readonly referralId: string;
  readonly amount: number;

  constructor(props: DomainEventProps<ReferralRewardClawedBackEvent>) {
    super(props);
    this.vendorId = props.vendorId;
    this.referralId = props.referralId;
    this.amount = props.amount;
  }
}

export class CreditRedeemedEvent extends DomainEvent {
  readonly vendorId: string;
  readonly amount: number;
  readonly redemptionType: string;

  constructor(props: DomainEventProps<CreditRedeemedEvent>) {
    super(props);
    this.vendorId = props.vendorId;
    this.amount = props.amount;
    this.redemptionType = props.redemptionType;
  }
}
