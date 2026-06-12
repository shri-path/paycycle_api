import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export interface SubscriptionExpiredPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  planId: bigint;
  occurredAt: Date;
}

export class SubscriptionExpiredEvent extends DomainEventBase {
  readonly type = 'subscription.expired' as const;

  constructor(
    public readonly payload: SubscriptionExpiredPayload,
    metadata: DomainEventMetadata
  ) {
    super(payload.vendorSubscriptionId.toString(), metadata);
  }
}
