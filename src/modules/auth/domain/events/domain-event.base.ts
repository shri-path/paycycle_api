import { randomUUID } from 'crypto';

export interface DomainEventMetadata {
  readonly correlationId: string;
  readonly causationId?: string;
}

/**
 * Base class for all domain events.
 * Every event carries an id (UUID), aggregateId (entity ID as string),
 * occurredAt timestamp, and structured metadata with correlationId / causationId.
 *
 * Events collected in entity._domainEvents are dispatched by the event bus
 * (not implemented in v1 — fire-and-forget, logged for future audit module).
 */
export abstract class DomainEventBase {
  readonly id: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly metadata: DomainEventMetadata;
  abstract readonly type: string;

  protected constructor(aggregateId: string, metadata: DomainEventMetadata) {
    this.id = randomUUID();
    this.aggregateId = aggregateId;
    this.occurredAt = new Date();
    this.metadata = metadata;
  }
}
