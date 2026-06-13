/**
 * Domain exceptions for the BulkOperation aggregate.
 * Framework-free.
 */

export class InvalidBulkOperationTransitionError extends Error {
  readonly code = 'INVALID_BULK_OPERATION_TRANSITION';

  constructor(from: string, to: string) {
    super(`Invalid BulkOperation state transition: "${from}" → "${to}".`);
    this.name = 'InvalidBulkOperationTransitionError';
    Error.captureStackTrace(this, this.constructor);
  }
}
