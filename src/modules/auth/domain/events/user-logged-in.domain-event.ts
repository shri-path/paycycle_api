import { DomainEventBase, DomainEventMetadata } from './domain-event.base';

export class UserLoggedInEvent extends DomainEventBase {
  readonly type = 'UserLoggedInEvent';

  constructor(
    public readonly userId: bigint,
    public readonly phone: string,
    public readonly ip: string | undefined,
    public readonly userAgent: string | undefined,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(userId.toString(), metadata);
  }
}
