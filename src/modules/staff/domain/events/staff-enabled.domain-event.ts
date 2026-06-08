import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class StaffEnabledEvent extends DomainEventBase {
  readonly type = 'StaffEnabledEvent';

  constructor(
    public readonly membershipId: bigint,
    public readonly vendorId: bigint,
    public readonly userId: bigint,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(membershipId.toString(), metadata);
  }
}
