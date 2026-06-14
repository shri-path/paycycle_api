import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';
import { CreditTypeEnum, CreditBreachActionEnum } from '../credit.types';

export class CustomerCreditSettingsUpdatedEvent extends DomainEventBase {
  readonly type = 'CustomerCreditSettingsUpdated';
  readonly customerId: string;
  readonly vendorId: string;
  readonly creditType: CreditTypeEnum;
  readonly actionOnBreach: CreditBreachActionEnum;

  constructor(
    settingsId: bigint,
    customerId: bigint,
    vendorId: bigint,
    creditType: CreditTypeEnum,
    actionOnBreach: CreditBreachActionEnum,
    metadata: DomainEventMetadata
  ) {
    super(settingsId.toString(), metadata);
    this.customerId = customerId.toString();
    this.vendorId = vendorId.toString();
    this.creditType = creditType;
    this.actionOnBreach = actionOnBreach;
  }
}
