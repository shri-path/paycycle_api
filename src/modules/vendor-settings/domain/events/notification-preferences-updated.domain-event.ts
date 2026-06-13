/**
 * NotificationPreferencesUpdatedEvent — emitted after updateNotificationPreferences() succeeds.
 * Framework-free.
 */
import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export interface NotificationPreferencesUpdatedPayload {
  aggregateId: bigint;
  vendorId: bigint;
  changedKeys: string[];
}

export class NotificationPreferencesUpdatedEvent extends DomainEventBase {
  readonly type = 'vendor-settings.notification-preferences-updated' as const;

  constructor(
    public readonly payload: NotificationPreferencesUpdatedPayload,
    metadata: DomainEventMetadata
  ) {
    super(payload.aggregateId.toString(), metadata);
  }
}
