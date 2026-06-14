import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';
import { CreditBreachActionEnum } from '../credit.types';

export class CustomerCreditBreachedEvent extends DomainEventBase {
  readonly type = 'CustomerCreditBreached';
  readonly customerId: string;
  readonly vendorId: string;
  readonly balance: number;
  readonly creditLimit: number;
  readonly action: CreditBreachActionEnum;

  constructor(
    customerId: bigint,
    vendorId: bigint,
    balance: number,
    creditLimit: number,
    action: CreditBreachActionEnum,
    metadata: DomainEventMetadata
  ) {
    super(customerId.toString(), metadata);
    this.customerId = customerId.toString();
    this.vendorId = vendorId.toString();
    this.balance = balance;
    this.creditLimit = creditLimit;
    this.action = action;
  }
}
