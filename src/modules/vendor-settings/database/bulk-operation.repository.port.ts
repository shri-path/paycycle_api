/**
 * IBulkOperationRepository — port for BulkOperationLog persistence.
 */
import { BulkOperationEntity } from '../domain/bulk-operation/bulk-operation.entity';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

export interface IBulkOperationRepository {
  /** Insert a new BulkOperation (status PENDING) and return with assigned id. */
  insert(entity: BulkOperationEntity, tx?: PrismaTransaction): Promise<BulkOperationEntity>;

  /** Update an existing BulkOperation (status, affectedCount, metadata, errorMessage, completedAt). */
  save(entity: BulkOperationEntity, tx?: PrismaTransaction): Promise<BulkOperationEntity>;

  /** Find by id. If vendorId is provided, mask as null if not matching (tenant isolation). */
  findById(
    id: bigint,
    vendorId?: bigint,
    tx?: PrismaTransaction
  ): Promise<BulkOperationEntity | null>;

  /** Find all PENDING operations (for in-process worker). */
  findPending(vendorId?: bigint, tx?: PrismaTransaction): Promise<BulkOperationEntity[]>;
}
