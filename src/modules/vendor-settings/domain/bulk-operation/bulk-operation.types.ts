/**
 * Domain types for the BulkOperation aggregate.
 * Framework-free: no Prisma, Express, or Pino imports.
 */

export enum BulkOperationType {
  MARK_LEAVE = 'MARK_LEAVE',
  ADJUST_RATE = 'ADJUST_RATE',
  SEND_REMINDERS = 'SEND_REMINDERS',
}

export enum BulkOperationTargetType {
  ALL = 'ALL',
  SUBSCRIPTION = 'SUBSCRIPTION',
  CUSTOMER = 'CUSTOMER',
}

export enum BulkOperationStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface BulkOperationProps {
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
}

export interface BulkOperationCreateProps {
  vendorId: bigint;
  operationType: BulkOperationType;
  targetType: BulkOperationTargetType;
  targetId?: bigint | null;
  metadata?: Record<string, unknown>;
  performedByUserId: bigint;
}
