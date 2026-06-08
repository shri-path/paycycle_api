import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';
import { PermissionKey } from '../value-objects/permission-key.value-object';

export class StaffPermissionsChangedEvent extends DomainEventBase {
  readonly type = 'StaffPermissionsChangedEvent';

  constructor(
    public readonly membershipId: bigint,
    public readonly vendorId: bigint,
    public readonly userId: bigint,
    public readonly before: PermissionKey[],
    public readonly after: PermissionKey[],
    correlationId: string,
    causationId?: string
  ) {
    const metadata: DomainEventMetadata = causationId
      ? { correlationId, causationId }
      : { correlationId };
    super(membershipId.toString(), metadata);
  }
}
