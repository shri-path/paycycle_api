import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { ListDefaults } from '../../domain/subscription.types';
import {
  SubscriptionNotFoundError,
  SupplyListNotFoundError,
} from '../../domain/supply-list.errors';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { SubscriptionMapper } from '../../database/subscription.mapper';
import { buildSubscriptionDtos } from '../../database/subscription-projection';
import { CustomerDirectoryPort } from '../../ports/customer-directory.port';
import { SubscriptionDto } from '../../supply-list.types';

export interface UpdateSubscriptionRequestDto {
  vendorId: bigint;
  listId: bigint;
  subscriptionId: bigint;
  quantity?: number | null;
  ratePerUnit?: number | null;
  status?: 'active' | 'paused';
  actorUserId: bigint;
  actorRole: string;
  ip: string | null;
  userAgent: string | null;
}

export class UpdateSubscriptionService {
  constructor(
    private readonly listRepository: ISupplyListRepository,
    private readonly subscriptionRepository: ISubscriptionRepository,
    private readonly customerDirectory: CustomerDirectoryPort,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: update a subscription's pricing overrides and/or active status. */
  async execute(dto: UpdateSubscriptionRequestDto): Promise<SubscriptionDto> {
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

    // Apply pricing changes through the entity (validates VOs).
    if (dto.quantity !== undefined || dto.ratePerUnit !== undefined) {
      entity.updatePricing(dto.quantity, dto.ratePerUnit, correlationId);
    }
    // Apply status transition (validates the state machine → 422 on illegal).
    if (dto.status === 'paused') {
      entity.pause(correlationId);
    } else if (dto.status === 'active') {
      entity.resume(correlationId);
    }

    const props = entity.getProps();
    try {
      if (dto.quantity !== undefined || dto.ratePerUnit !== undefined) {
        await this.subscriptionRepository.updatePricing(dto.subscriptionId, {
          ...(dto.quantity !== undefined ? { customQuantity: props.customQuantity } : {}),
          ...(dto.ratePerUnit !== undefined ? { customRatePerUnit: props.customRatePerUnit } : {}),
        });
      }
      if (dto.status !== undefined) {
        await this.subscriptionRepository.updateActive(dto.subscriptionId, props.isActive);
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'UpdateSubscriptionService: update failed');
      throw new InternalServerError('Failed to update subscription. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.actorUserId,
      performedByRole: dto.actorRole,
      action: AuditAction.SUBSCRIPTION_UPDATED,
      entityType: 'supply_list_customer',
      entityId: dto.subscriptionId,
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    const reloaded = await this.subscriptionRepository.findById(
      dto.subscriptionId,
      dto.vendorId,
      dto.listId
    );
    if (!reloaded) throw new InternalServerError('Failed to reload subscription.');

    const listDefaults: ListDefaults = {
      defaultQuantity:
        list.defaultQuantity === null ? null : Number(list.defaultQuantity.toString()),
      ratePerUnit: list.ratePerUnit === null ? null : Number(list.ratePerUnit.toString()),
    };
    const [dtoResult] = await buildSubscriptionDtos(
      [reloaded],
      dto.vendorId,
      dto.listId,
      listDefaults,
      this.subscriptionRepository,
      this.customerDirectory
    );
    return dtoResult!;
  }
}
