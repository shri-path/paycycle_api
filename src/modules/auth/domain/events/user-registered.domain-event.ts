import { DomainEventBase, DomainEventMetadata } from './domain-event.base';

export class UserRegisteredEvent extends DomainEventBase {
  readonly type = 'UserRegisteredEvent';

  constructor(
    public readonly userId: bigint,
    public readonly phone: string,
    public readonly vendorId: bigint,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(userId.toString(), metadata);
  }
}
