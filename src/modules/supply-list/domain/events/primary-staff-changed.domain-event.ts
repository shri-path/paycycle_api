import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class PrimaryStaffChangedEvent extends DomainEventBase {
  readonly type = 'PrimaryStaffChangedEvent';

  constructor(
    public readonly supplyListId: bigint,
    public readonly vendorId: bigint,
    public readonly oldPrimaryId: bigint | null,
    public readonly newPrimaryId: bigint | null,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(supplyListId.toString(), metadata);
  }
}
