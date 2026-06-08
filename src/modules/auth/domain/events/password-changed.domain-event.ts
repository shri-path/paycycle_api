import { DomainEventBase, DomainEventMetadata } from './domain-event.base';

export class PasswordChangedEvent extends DomainEventBase {
  readonly type = 'PasswordChangedEvent';

  constructor(
    public readonly userId: bigint,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(userId.toString(), metadata);
  }
}
