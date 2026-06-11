import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { SupplyListNotFoundError } from '../../domain/supply-list.errors';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { SupplyListMapper } from '../../database/supply-list.mapper';
import { ArchiveListResultDto } from '../../supply-list.types';

export interface ArchiveSupplyListRequestDto {
  vendorId: bigint;
  listId: bigint;
  actorUserId: bigint;
  actorRole: string;
  ip: string | null;
  userAgent: string | null;
}

export class ArchiveSupplyListService {
  constructor(
    private readonly repository: ISupplyListRepository,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: archive (soft) a supply list — always soft, never hard (edge #1). */
  async execute(dto: ArchiveSupplyListRequestDto): Promise<ArchiveListResultDto> {
    const correlationId = crypto.randomUUID();

    const record = await this.repository.findById(dto.listId, dto.vendorId);
    if (!record || record.deletedAt !== null) {
      throw new SupplyListNotFoundError();
    }

    const entity = SupplyListMapper.toDomain(record);
    entity.archive(correlationId);

    try {
      await this.repository.archive(dto.listId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'ArchiveSupplyListService: archive failed');
      throw new InternalServerError('Failed to archive supply list. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.actorUserId,
      performedByRole: dto.actorRole,
      action: AuditAction.LIST_ARCHIVED,
      entityType: 'supply_list',
      entityId: dto.listId,
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    this.logger.info(
      { vendorId: dto.vendorId.toString(), listId: dto.listId.toString(), correlationId },
      'ArchiveSupplyListService: list archived'
    );

    return { id: dto.listId.toString(), status: 'archived' };
  }
}
