---
name: DomainEventBase
description: All domain events must extend DomainEventBase (id, aggregateId, occurredAt, metadata)
metadata:
  type: project
---
Every domain event class must extend `DomainEventBase`, which provides: `id: string` (UUID), `aggregateId: string`, `occurredAt: Date`, and `metadata: { correlationId: string; causationId?: string }`. The base lives at `src/modules/auth/domain/events/domain-event.base.ts` (or a shared equivalent).

**Why:** Without a consistent base structure, events cannot be reliably dispatched, logged, or consumed by downstream modules (Audit, Notifications). Caught as CRITICAL in Review during US-003 where event classes were plain classes with no base.

**How to apply:** Define each new event as a subclass of `DomainEventBase`, populating `aggregateId` and threading `metadata.correlationId` from the originating request.
