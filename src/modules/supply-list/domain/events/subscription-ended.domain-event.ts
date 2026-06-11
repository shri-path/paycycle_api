import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class SubscriptionEndedEvent extends DomainEventBase {
  readonly type = 'SubscriptionEndedEvent';

  constructor(
    public readonly subscriptionId: bigint,
    public readonly vendorId: bigint,
    public readonly supplyListId: bigint,
    public readonly customerId: bigint,
    public readonly endDate: Date,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(subscriptionId.toString(), metadata);
  }
}
