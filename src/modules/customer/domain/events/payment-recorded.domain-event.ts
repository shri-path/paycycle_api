import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class PaymentRecordedEvent extends DomainEventBase {
  readonly type = 'PaymentRecorded';
  readonly customerId: string;
  readonly vendorId: string;
  readonly amount: number;
  readonly paymentDate: string;

  constructor(
    paymentId: bigint,
    customerId: bigint,
    vendorId: bigint,
    amount: number,
    paymentDate: Date,
    metadata: DomainEventMetadata
  ) {
    super(paymentId.toString(), metadata);
    this.customerId = customerId.toString();
    this.vendorId = vendorId.toString();
    this.amount = amount;
    this.paymentDate = paymentDate.toISOString().slice(0, 10);
  }
}
