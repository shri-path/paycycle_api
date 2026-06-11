import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class SupplyListArchivedEvent extends DomainEventBase {
  readonly type = 'SupplyListArchivedEvent';

  constructor(
    public readonly supplyListId: bigint,
    public readonly vendorId: bigint,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(supplyListId.toString(), metadata);
  }
}
