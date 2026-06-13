/**
 * GetBulkOperationQuery — Query (read-only, no side effects).
 * Returns bulk operation status; 404 if not found or wrong vendor (tenant masking).
 */
import { NotFoundError } from '@/common/errors/app-error';
import { IBulkOperationRepository } from '../../database/bulk-operation.repository.port';
import { BulkOperationMapper, BulkOperationDto } from '../../bulk-operation.mapper';

export class GetBulkOperationQuery {
  constructor(private readonly repo: IBulkOperationRepository) {}

  async execute(operationId: bigint, vendorId: bigint): Promise<BulkOperationDto> {
    const entity = await this.repo.findById(operationId, vendorId);

    if (!entity) {
      throw new NotFoundError('Bulk operation not found');
    }

    return BulkOperationMapper.toResponse(entity);
  }
}
