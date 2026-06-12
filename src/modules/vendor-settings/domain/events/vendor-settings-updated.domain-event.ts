/**
 * VendorSettingsUpdatedEvent — emitted after VendorSettingsEntity.update() succeeds.
 * Framework-free.
 */
import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export interface VendorSettingsUpdatedPayload {
  aggregateId: bigint;
  vendorId: bigint;
  changed: string[];
  autoMarkEnabled: boolean;
  autoSendBillsEnabled: boolean;
  autoSendBillsTime: string;
}

export class VendorSettingsUpdatedEvent extends DomainEventBase {
  readonly type = 'vendor-settings.updated' as const;

  constructor(
    public readonly payload: VendorSettingsUpdatedPayload,
    metadata: DomainEventMetadata
  ) {
    super(payload.aggregateId.toString(), metadata);
  }
}
