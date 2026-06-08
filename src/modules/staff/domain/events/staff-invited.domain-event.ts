import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class StaffInvitedEvent extends DomainEventBase {
  readonly type = 'StaffInvitedEvent';

  constructor(
    public readonly membershipId: bigint,
    public readonly vendorId: bigint,
    public readonly phone: string,
    public readonly invitedByUserId: bigint,
    public readonly inviteUrl: string,
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(membershipId.toString(), metadata);
  }
}
