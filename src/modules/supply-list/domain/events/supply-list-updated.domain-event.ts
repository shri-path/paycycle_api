import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class SupplyListUpdatedEvent extends DomainEventBase {
  readonly type = 'SupplyListUpdatedEvent';

  constructor(
    public readonly supplyListId: bigint,
    public readonly vendorId: bigint,
    public readonly changedFields: string[],
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(supplyListId.toString(), metadata);
  }
}
