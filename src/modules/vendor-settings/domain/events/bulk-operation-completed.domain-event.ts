/**
 * BulkOperationCompletedEvent — emitted when BulkOperation reaches COMPLETED or FAILED.
 * Framework-free.
 */
import {
  DomainEventBase,
  DomainEventMetadata,
} from '@/modules/auth/domain/events/domain-event.base';

export interface BulkOperationCompletedPayload {
  operationId: bigint;
  vendorId: bigint;
  operationType: string;
  status: string;
  affectedCount: number;
}

export class BulkOperationCompletedEvent extends DomainEventBase {
  readonly type = 'bulk-operation.completed' as const;

  constructor(
    public readonly payload: BulkOperationCompletedPayload,
    metadata: DomainEventMetadata
  ) {
    super(payload.operationId.toString(), metadata);
  }
}
