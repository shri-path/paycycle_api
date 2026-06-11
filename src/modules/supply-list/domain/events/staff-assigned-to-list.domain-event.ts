import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class StaffAssignedToListEvent extends DomainEventBase {
  readonly type = 'StaffAssignedToListEvent';

  constructor(
    public readonly supplyListId: bigint,
    public readonly vendorId: bigint,
    public readonly vendorUserId: bigint,
    public readonly isPrimary: boolean,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(supplyListId.toString(), metadata);
  }
}
