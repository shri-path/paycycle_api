import { DomainEventBase, DomainEventMetadata } from './domain-event.base';

export class VendorCreatedEvent extends DomainEventBase {
  readonly type = 'VendorCreatedEvent';

  constructor(
    public readonly vendorId: bigint,
    public readonly name: string,
    public readonly ownerUserId: bigint,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(vendorId.toString(), metadata);
  }
}
