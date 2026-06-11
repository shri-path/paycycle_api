import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class CustomerSubscribedEvent extends DomainEventBase {
  readonly type = 'CustomerSubscribedEvent';

  constructor(
    public readonly subscriptionId: bigint,
    public readonly vendorId: bigint,
    public readonly supplyListId: bigint,
    public readonly customerId: bigint,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(subscriptionId.toString(), metadata);
  }
}
