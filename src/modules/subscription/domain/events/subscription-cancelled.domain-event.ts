import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export interface SubscriptionCancelledPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  planId: bigint;
  performedByUserId?: bigint | null;
  occurredAt: Date;
}

export class SubscriptionCancelledEvent extends DomainEventBase {
  readonly type = 'subscription.cancelled' as const;

  constructor(
    public readonly payload: SubscriptionCancelledPayload,
    metadata: DomainEventMetadata
  ) {
    super(payload.vendorSubscriptionId.toString(), metadata);
  }
}
