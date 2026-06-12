import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export interface SubscriptionRenewedPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  planId: bigint;
  performedByUserId?: bigint | null;
  occurredAt: Date;
}

export class SubscriptionRenewedEvent extends DomainEventBase {
  readonly type = 'subscription.renewed' as const;

  constructor(
    public readonly payload: SubscriptionRenewedPayload,
    metadata: DomainEventMetadata
  ) {
    super(payload.vendorSubscriptionId.toString(), metadata);
  }
}
