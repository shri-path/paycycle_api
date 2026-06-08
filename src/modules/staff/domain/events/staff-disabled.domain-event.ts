import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class StaffDisabledEvent extends DomainEventBase {
  readonly type = 'StaffDisabledEvent';

  constructor(
    public readonly membershipId: bigint,
    public readonly vendorId: bigint,
    public readonly userId: bigint,
    public readonly disabledByUserId: bigint,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(membershipId.toString(), metadata);
  }
}
