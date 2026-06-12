import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export interface SubscriptionCreatedPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  newPlanId: bigint;
  performedByUserId?: bigint | null;
  occurredAt: Date;
}

export class SubscriptionCreatedEvent extends DomainEventBase {
  readonly type = 'subscription.created' as const;

  constructor(
    public readonly payload: SubscriptionCreatedPayload,
    metadata: DomainEventMetadata
  ) {
    super(payload.vendorSubscriptionId.toString(), metadata);
  }
}
