import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class SubscriptionUpdatedEvent extends DomainEventBase {
  readonly type = 'SubscriptionUpdatedEvent';

  constructor(
    public readonly subscriptionId: bigint,
    public readonly vendorId: bigint,
    public readonly changedFields: string[],
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(subscriptionId.toString(), metadata);
  }
}
