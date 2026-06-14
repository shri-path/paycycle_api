import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export class ReminderConfigUpdatedEvent extends DomainEventBase {
  readonly type = 'ReminderConfigUpdated';
  readonly vendorId: string;
  readonly autoRemindersEnabled: boolean;

  constructor(
    configId: bigint,
    vendorId: bigint,
    autoRemindersEnabled: boolean,
    metadata: DomainEventMetadata
  ) {
    super(configId.toString(), metadata);
    this.vendorId = vendorId.toString();
    this.autoRemindersEnabled = autoRemindersEnabled;
  }
}
