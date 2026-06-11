import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class StaffUnassignedFromListEvent extends DomainEventBase {
  readonly type = 'StaffUnassignedFromListEvent';

  constructor(
    public readonly supplyListId: bigint,
    public readonly vendorId: bigint,
    public readonly vendorUserId: bigint,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(supplyListId.toString(), metadata);
  }
}
