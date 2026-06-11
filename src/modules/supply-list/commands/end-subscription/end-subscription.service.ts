import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import {
  SubscriptionNotFoundError,
  SupplyListNotFoundError,
} from '../../domain/supply-list.errors';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { SubscriptionMapper } from '../../database/subscription.mapper';
import { EndSubscriptionResultDto } from '../../supply-list.types';

export interface EndSubscriptionRequestDto {
  vendorId: bigint;
  listId: bigint;
  subscriptionId: bigint;
  actorUserId: bigint;
  actorRole: string;
  ip: string | null;
  userAgent: string | null;
}

export class EndSubscriptionService {
  constructor(
    private readonly listRepository: ISupplyListRepository,
    private readonly subscriptionRepository: ISubscriptionRepository,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: end a subscription (status=ENDED, endDate=today, history preserved). */
  async execute(dto: EndSubscriptionRequestDto): Promise<EndSubscriptionResultDto> {
    const correlationId = crypto.randomUUID();

    const list = await this.listRepository.findById(dto.listId, dto.vendorId);
    if (!list || list.deletedAt !== null) {
      throw new SupplyListNotFoundError();
    }

    const record = await this.subscriptionRepository.findById(
      dto.subscriptionId,
      dto.vendorId,
      dto.listId
    );
    if (!record || record.deletedAt !== null) {
      throw new SubscriptionNotFoundError();
    }

    const entity = SubscriptionMapper.toDomain(record);
    entity.end(correlationId);
    const props = entity.getProps();
    const endDate = props.endDate!;

    try {
      await this.subscriptionRepository.end(dto.subscriptionId, endDate);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'EndSubscriptionService: end failed');
      throw new InternalServerError('Failed to end subscription. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.actorUserId,
      performedByRole: dto.actorRole,
      action: AuditAction.SUBSCRIPTION_ENDED,
      entityType: 'supply_list_customer',
      entityId: dto.subscriptionId,
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    this.logger.info(
      {
        vendorId: dto.vendorId.toString(),
        subscriptionId: dto.subscriptionId.toString(),
        correlationId,
      },
      'EndSubscriptionService: subscription ended'
    );

    return {
      subscriptionId: dto.subscriptionId.toString(),
      status: 'ended',
      endDate: endDate.toISOString().slice(0, 10),
    };
  }
}
