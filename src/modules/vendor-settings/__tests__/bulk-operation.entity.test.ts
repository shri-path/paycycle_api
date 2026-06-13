/**
 * Unit tests for BulkOperationEntity aggregate root state machine.
 */
import { BulkOperationEntity } from '../domain/bulk-operation/bulk-operation.entity';
import {
  BulkOperationStatus,
  BulkOperationTargetType,
  BulkOperationType,
} from '../domain/bulk-operation/bulk-operation.types';
import { InvalidBulkOperationTransitionError } from '../domain/bulk-operation/bulk-operation.errors';
import { BulkOperationCompletedEvent } from '../domain/events/bulk-operation-completed.domain-event';

const makeOp = (): BulkOperationEntity =>
  BulkOperationEntity.create({
    vendorId: 1n,
    operationType: BulkOperationType.MARK_LEAVE,
    targetType: BulkOperationTargetType.ALL,
    performedByUserId: 99n,
    metadata: { date: '2026-07-01' },
  });

describe('BulkOperationEntity', () => {
  describe('create()', () => {
    it('should start in PENDING status', () => {
      const op = makeOp();
      expect(op.status).toBe(BulkOperationStatus.PENDING);
    });

    it('should have zero affectedCount initially', () => {
      const op = makeOp();
      expect(op.affectedCount).toBe(0);
    });

    it('should have null errorMessage initially', () => {
      const op = makeOp();
      expect(op.errorMessage).toBeNull();
    });
  });

  describe('start()', () => {
    it('should transition PENDING → IN_PROGRESS', () => {
      const op = makeOp();
      op.start();
      expect(op.status).toBe(BulkOperationStatus.IN_PROGRESS);
    });

    it('should throw if called twice (IN_PROGRESS → IN_PROGRESS is invalid)', () => {
      const op = makeOp();
      op.start();
      expect(() => op.start()).toThrow(InvalidBulkOperationTransitionError);
    });

    it('should throw if called on COMPLETED operation', () => {
      const op = makeOp();
      op.start();
      op.complete({}, 0);
      expect(() => op.start()).toThrow(InvalidBulkOperationTransitionError);
    });
  });

  describe('complete()', () => {
    it('should transition IN_PROGRESS → COMPLETED', () => {
      const op = makeOp();
      op.start();
      op.complete({ customersAffected: 10 }, 10, { correlationId: 'test' });
      expect(op.status).toBe(BulkOperationStatus.COMPLETED);
      expect(op.affectedCount).toBe(10);
      expect(op.completedAt).not.toBeNull();
    });

    it('should throw if called from PENDING (skipping IN_PROGRESS)', () => {
      const op = makeOp();
      expect(() => op.complete({}, 0)).toThrow(InvalidBulkOperationTransitionError);
    });

    it('should throw if called on already-COMPLETED operation', () => {
      const op = makeOp();
      op.start();
      op.complete({}, 0);
      expect(() => op.complete({}, 0)).toThrow(InvalidBulkOperationTransitionError);
    });

    it('should emit BulkOperationCompletedEvent', () => {
      const op = makeOp();
      op.assignId(42n);
      op.start();
      op.complete({ done: true }, 5, { correlationId: 'c1' });

      const events = op.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as BulkOperationCompletedEvent;
      expect(event.type).toBe('bulk-operation.completed');
      expect(event.payload.operationId).toBe(42n);
      expect(event.payload.status).toBe(BulkOperationStatus.COMPLETED);
      expect(event.payload.affectedCount).toBe(5);
      expect(event.metadata.correlationId).toBe('c1');
    });

    it('should store summary in metadata', () => {
      const op = makeOp();
      op.start();
      op.complete({ customersAffected: 7, skipped: 2 }, 7);
      expect(op.metadata['summary']).toEqual({
        customersAffected: 7,
        skipped: 2,
      });
    });
  });

  describe('fail()', () => {
    it('should transition PENDING → FAILED', () => {
      const op = makeOp();
      op.fail('Validation failed', { correlationId: 'test' });
      expect(op.status).toBe(BulkOperationStatus.FAILED);
      expect(op.errorMessage).toBe('Validation failed');
    });

    it('should transition IN_PROGRESS → FAILED', () => {
      const op = makeOp();
      op.start();
      op.fail('Processing error');
      expect(op.status).toBe(BulkOperationStatus.FAILED);
    });

    it('should throw if called on COMPLETED operation', () => {
      const op = makeOp();
      op.start();
      op.complete({}, 0);
      expect(() => op.fail('oops')).toThrow(InvalidBulkOperationTransitionError);
    });

    it('should throw if called on FAILED operation', () => {
      const op = makeOp();
      op.fail('first failure');
      expect(() => op.fail('second failure')).toThrow(InvalidBulkOperationTransitionError);
    });

    it('should emit BulkOperationCompletedEvent with FAILED status', () => {
      const op = makeOp();
      op.assignId(10n);
      op.fail('error', { correlationId: 'fail-corr' });
      const events = op.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as BulkOperationCompletedEvent;
      expect(event.payload.status).toBe(BulkOperationStatus.FAILED);
    });
  });

  describe('pullEvents()', () => {
    it('should clear the event queue after pulling', () => {
      const op = makeOp();
      op.start();
      op.complete({}, 0);
      expect(op.pullEvents()).toHaveLength(1);
      expect(op.pullEvents()).toHaveLength(0);
    });
  });

  describe('fromPersistence()', () => {
    it('should reconstitute a COMPLETED operation', () => {
      const now = new Date();
      const op = BulkOperationEntity.fromPersistence({
        id: 5n,
        vendorId: 1n,
        operationType: BulkOperationType.ADJUST_RATE,
        targetType: BulkOperationTargetType.SUBSCRIPTION,
        targetId: null,
        affectedCount: 20,
        status: BulkOperationStatus.COMPLETED,
        metadata: { summary: { listsAffected: 2 } },
        errorMessage: null,
        performedByUserId: 99n,
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      expect(op.id).toBe(5n);
      expect(op.status).toBe(BulkOperationStatus.COMPLETED);
      expect(op.affectedCount).toBe(20);
    });
  });
});
