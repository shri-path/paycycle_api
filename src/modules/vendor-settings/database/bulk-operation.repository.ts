/**
 * BulkOperationRepository — Prisma adapter for IBulkOperationRepository.
 */
import { Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { BulkOperationEntity } from '../domain/bulk-operation/bulk-operation.entity';
import { BulkOperationMapper } from '../bulk-operation.mapper';
import { IBulkOperationRepository } from './bulk-operation.repository.port';

export class BulkOperationRepository implements IBulkOperationRepository {
  async insert(entity: BulkOperationEntity, tx?: PrismaTransaction): Promise<BulkOperationEntity> {
    const client = tx ?? prisma;
    const data = BulkOperationMapper.toPersistence(entity);

    const row = await client.bulkOperationLog.create({
      data: {
        ...data,
        metadata: data.metadata as Prisma.InputJsonValue,
      },
    });
    entity.assignId(row.id);
    return BulkOperationMapper.toDomain(row);
  }

  async save(entity: BulkOperationEntity, tx?: PrismaTransaction): Promise<BulkOperationEntity> {
    const client = tx ?? prisma;
    const props = entity.getProps();

    const row = await client.bulkOperationLog.update({
      where: { id: props.id },
      data: {
        status: props.status,
        affectedCount: props.affectedCount,
        metadata: props.metadata as Prisma.InputJsonValue,
        errorMessage: props.errorMessage,
        startedAt: props.startedAt,
        completedAt: props.completedAt,
        updatedAt: props.updatedAt,
      },
    });
    return BulkOperationMapper.toDomain(row);
  }

  async findById(
    id: bigint,
    vendorId?: bigint,
    tx?: PrismaTransaction
  ): Promise<BulkOperationEntity | null> {
    const client = tx ?? prisma;
    const row = await client.bulkOperationLog.findFirst({
      where: { id, deletedAt: null },
    });

    if (!row) return null;
    // Multi-tenant masking: return null if vendorId doesn't match
    if (vendorId !== undefined && row.vendorId !== vendorId) return null;

    return BulkOperationMapper.toDomain(row);
  }

  async findPending(vendorId?: bigint, tx?: PrismaTransaction): Promise<BulkOperationEntity[]> {
    const client = tx ?? prisma;
    const rows = await client.bulkOperationLog.findMany({
      where: {
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        deletedAt: null,
        ...(vendorId ? { vendorId } : {}),
      },
    });
    return rows.map((r) => BulkOperationMapper.toDomain(r));
  }
}
