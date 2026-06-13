/**
 * BulkOperationEntity — aggregate root for bulk_operations_log.
 * State machine: PENDING → IN_PROGRESS → COMPLETED/FAILED
 *                PENDING → FAILED (validation failed before work began)
 * Framework-free: no Prisma, Express, or Pino imports.
 */
import { DomainEventMetadata } from '@/modules/auth/domain/events/domain-event.base';
import { BulkOperationCompletedEvent } from '../events/bulk-operation-completed.domain-event';
import { InvalidBulkOperationTransitionError } from './bulk-operation.errors';
import {
  BulkOperationCreateProps,
  BulkOperationProps,
  BulkOperationStatus,
  BulkOperationTargetType,
  BulkOperationType,
} from './bulk-operation.types';

/** Valid state transitions */
const ALLOWED_TRANSITIONS: Record<BulkOperationStatus, BulkOperationStatus[]> = {
  [BulkOperationStatus.PENDING]: [BulkOperationStatus.IN_PROGRESS, BulkOperationStatus.FAILED],
  [BulkOperationStatus.IN_PROGRESS]: [BulkOperationStatus.COMPLETED, BulkOperationStatus.FAILED],
  [BulkOperationStatus.COMPLETED]: [],
  [BulkOperationStatus.FAILED]: [],
};

export class BulkOperationEntity {
  private _events: BulkOperationCompletedEvent[] = [];

  private constructor(
    private _id: bigint,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
    private _props: BulkOperationProps
  ) {}

  // ── Getters ────────────────────────────────────────────────────────────────

  get id(): bigint {
    return this._id;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  get vendorId(): bigint {
    return this._props.vendorId;
  }
  get operationType(): BulkOperationType {
    return this._props.operationType;
  }
  get targetType(): BulkOperationTargetType {
    return this._props.targetType;
  }
  get targetId(): bigint | null {
    return this._props.targetId;
  }
  get affectedCount(): number {
    return this._props.affectedCount;
  }
  get status(): BulkOperationStatus {
    return this._props.status;
  }
  get metadata(): Record<string, unknown> {
    return this._props.metadata;
  }
  get errorMessage(): string | null {
    return this._props.errorMessage;
  }
  get performedByUserId(): bigint {
    return this._props.performedByUserId;
  }
  get startedAt(): Date {
    return this._props.startedAt;
  }
  get completedAt(): Date | null {
    return this._props.completedAt;
  }

  getProps(): Readonly<BulkOperationProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      ...this._props,
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    });
  }

  pullEvents(): BulkOperationCompletedEvent[] {
    const events = [...this._events];
    this._events = [];
    return events;
  }

  /** Assign a persisted ID after insert. */
  assignId(id: bigint): void {
    this._id = id;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private transition(to: BulkOperationStatus): void {
    const allowed = ALLOWED_TRANSITIONS[this._props.status];
    if (!allowed.includes(to)) {
      throw new InvalidBulkOperationTransitionError(this._props.status, to);
    }
    this._props = { ...this._props, status: to };
    this._updatedAt = new Date();
  }

  // ── Behaviour ──────────────────────────────────────────────────────────────

  /** Transition PENDING → IN_PROGRESS. */
  start(): void {
    this.transition(BulkOperationStatus.IN_PROGRESS);
    this._props = { ...this._props, startedAt: new Date() };
  }

  /** Transition IN_PROGRESS → COMPLETED. */
  complete(
    summary: Record<string, unknown>,
    affectedCount: number,
    metadata?: DomainEventMetadata
  ): void {
    this.transition(BulkOperationStatus.COMPLETED);
    const now = new Date();
    this._props = {
      ...this._props,
      affectedCount,
      completedAt: now,
      metadata: { ...this._props.metadata, summary },
    };
    this._updatedAt = now;

    const meta: DomainEventMetadata = metadata ?? { correlationId: 'system' };
    this._events.push(
      new BulkOperationCompletedEvent(
        {
          operationId: this._id,
          vendorId: this._props.vendorId,
          operationType: this._props.operationType,
          status: BulkOperationStatus.COMPLETED,
          affectedCount,
        },
        meta
      )
    );
  }

  /** Transition PENDING/IN_PROGRESS → FAILED. */
  fail(message: string, metadata?: DomainEventMetadata): void {
    this.transition(BulkOperationStatus.FAILED);
    const now = new Date();
    this._props = {
      ...this._props,
      errorMessage: message,
      completedAt: now,
    };
    this._updatedAt = now;

    const meta: DomainEventMetadata = metadata ?? { correlationId: 'system' };
    this._events.push(
      new BulkOperationCompletedEvent(
        {
          operationId: this._id,
          vendorId: this._props.vendorId,
          operationType: this._props.operationType,
          status: BulkOperationStatus.FAILED,
          affectedCount: this._props.affectedCount,
        },
        meta
      )
    );
  }

  // ── Factory: create new (PENDING) ─────────────────────────────────────────

  static create(props: BulkOperationCreateProps, now?: Date): BulkOperationEntity {
    const ts = now ?? new Date();
    return new BulkOperationEntity(0n, ts, ts, {
      vendorId: props.vendorId,
      operationType: props.operationType,
      targetType: props.targetType,
      targetId: props.targetId ?? null,
      affectedCount: 0,
      status: BulkOperationStatus.PENDING,
      metadata: props.metadata ?? {},
      errorMessage: null,
      performedByUserId: props.performedByUserId,
      startedAt: ts,
      completedAt: null,
    });
  }

  // ── Factory: reconstitute from persistence ────────────────────────────────

  static fromPersistence(row: {
    id: bigint;
    vendorId: bigint;
    operationType: BulkOperationType;
    targetType: BulkOperationTargetType;
    targetId: bigint | null;
    affectedCount: number;
    status: BulkOperationStatus;
    metadata: Record<string, unknown>;
    errorMessage: string | null;
    performedByUserId: bigint;
    startedAt: Date;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): BulkOperationEntity {
    return new BulkOperationEntity(row.id, row.createdAt, row.updatedAt, {
      vendorId: row.vendorId,
      operationType: row.operationType,
      targetType: row.targetType,
      targetId: row.targetId,
      affectedCount: row.affectedCount,
      status: row.status,
      metadata: row.metadata,
      errorMessage: row.errorMessage,
      performedByUserId: row.performedByUserId,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
    });
  }
}
