import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export interface SubscriptionUpgradedPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  oldPlanId: bigint;
  newPlanId: bigint;
  performedByUserId?: bigint | null;
  occurredAt: Date;
}

export class SubscriptionUpgradedEvent extends DomainEventBase {
  readonly type = 'subscription.upgraded' as const;

  constructor(
    public readonly payload: SubscriptionUpgradedPayload,
    metadata: DomainEventMetadata
  ) {
    super(payload.vendorSubscriptionId.toString(), metadata);
  }
}
