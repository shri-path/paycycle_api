import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class CustomerPrepaidEnabledEvent extends DomainEventBase {
  readonly type = 'CustomerPrepaidEnabled';
  readonly customerId: string;
  readonly vendorId: string;
  readonly clearedOutstandingFirst: boolean;
  readonly minimumBalanceWarning: number | null;

  constructor(
    customerId: bigint,
    vendorId: bigint,
    clearedOutstandingFirst: boolean,
    minimumBalanceWarning: number | null,
    metadata: DomainEventMetadata
  ) {
    super(customerId.toString(), metadata);
    this.customerId = customerId.toString();
    this.vendorId = vendorId.toString();
    this.clearedOutstandingFirst = clearedOutstandingFirst;
    this.minimumBalanceWarning = minimumBalanceWarning;
  }
}
