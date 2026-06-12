import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class CustomerDeactivatedEvent extends DomainEventBase {
  readonly type = 'CustomerDeactivated';
  readonly vendorId: string;

  constructor(customerId: bigint, vendorId: bigint, metadata: DomainEventMetadata) {
    super(customerId.toString(), metadata);
    this.vendorId = vendorId.toString();
  }
}
