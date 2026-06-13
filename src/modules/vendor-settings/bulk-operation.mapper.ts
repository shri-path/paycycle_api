/**
 * BulkOperationMapper — three-way mapper for BulkOperationLog.
 * toDomain: DB row → Entity
 * toPersistence: Entity → DB create input
 * toResponse: Entity → DTO (whitelisted)
 */
import { BulkOperationLog } from '@prisma/client';
import { BulkOperationEntity } from './domain/bulk-operation/bulk-operation.entity';
import {
  BulkOperationStatus,
  BulkOperationTargetType,
  BulkOperationType,
} from './domain/bulk-operation/bulk-operation.types';

export interface BulkOperationDto {
  operationId: string;
  operationType: string;
  targetType: string;
  status: string;
  affectedCount: number;
  summary: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export class BulkOperationMapper {
  /** DB row → Domain entity */
  static toDomain(row: BulkOperationLog): BulkOperationEntity {
    return BulkOperationEntity.fromPersistence({
      id: row.id,
      vendorId: row.vendorId,
      operationType: row.operationType as BulkOperationType,
      targetType: row.targetType as BulkOperationTargetType,
      targetId: row.targetId,
      affectedCount: row.affectedCount,
      status: row.status as BulkOperationStatus,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      errorMessage: row.errorMessage,
      performedByUserId: row.performedByUserId,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  /** Entity → Prisma create input */
  static toPersistence(entity: BulkOperationEntity): {
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
  } {
    const props = entity.getProps();
    return {
      vendorId: props.vendorId,
      operationType: props.operationType,
      targetType: props.targetType,
      targetId: props.targetId,
      affectedCount: props.affectedCount,
      status: props.status,
      metadata: props.metadata,
      errorMessage: props.errorMessage,
      performedByUserId: props.performedByUserId,
      startedAt: props.startedAt,
      completedAt: props.completedAt,
    };
  }

  /** Entity → Response DTO (whitelisted) */
  static toResponse(entity: BulkOperationEntity): BulkOperationDto {
    const props = entity.getProps();
    const metadata = props.metadata;
    const summary = (metadata['summary'] as Record<string, unknown>) ?? null;

    return {
      operationId: props.id.toString(),
      operationType: props.operationType,
      targetType: props.targetType,
      status: props.status,
      affectedCount: props.affectedCount,
      summary,
      errorMessage: props.errorMessage,
      startedAt: props.startedAt.toISOString(),
      completedAt: props.completedAt ? props.completedAt.toISOString() : null,
      createdAt: props.createdAt.toISOString(),
    };
  }

  /** Minimal response for bulk command results (operationId + status + summary) */
  static toCommandResponse(entity: BulkOperationEntity): {
    operationId: string;
    status: string;
    summary?: Record<string, unknown>;
  } {
    const props = entity.getProps();
    const metadata = props.metadata;
    const summary = metadata['summary'] as Record<string, unknown> | undefined;

    const result: { operationId: string; status: string; summary?: Record<string, unknown> } = {
      operationId: props.id.toString(),
      status: props.status,
    };
    if (summary) result.summary = summary;
    return result;
  }
}
