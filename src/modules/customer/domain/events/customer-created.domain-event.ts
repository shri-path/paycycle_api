import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class CustomerCreatedEvent extends DomainEventBase {
  readonly type = 'CustomerCreated';
  readonly vendorId: string;
  readonly phone: string;

  constructor(customerId: bigint, vendorId: bigint, phone: string, metadata: DomainEventMetadata) {
    super(customerId.toString(), metadata);
    this.vendorId = vendorId.toString();
    this.phone = phone;
  }
}
