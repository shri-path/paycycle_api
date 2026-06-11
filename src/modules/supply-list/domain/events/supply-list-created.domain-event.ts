import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class SupplyListCreatedEvent extends DomainEventBase {
  readonly type = 'SupplyListCreatedEvent';

  constructor(
    public readonly supplyListId: bigint,
    public readonly vendorId: bigint,
    public readonly name: string,
    public readonly createdByUserId: bigint | null,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(supplyListId.toString(), metadata);
  }
}
