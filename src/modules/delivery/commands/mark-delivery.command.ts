import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import { DailySupplyMapper, DeliveryNotFoundError } from '../delivery.domain';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { ActorMeta, DeliveryAccess } from '../delivery.shared';
import { MarkDeliveryResultDto } from '../delivery.types';

/** Command: mark a single delivery as DELIVERED or LEAVE. */
export class MarkDeliveryCommand {
  private readonly access: DeliveryAccess;

  constructor(
    private readonly repository: IDeliveryRepository,
    reader: DeliveryReader,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {
    this.access = new DeliveryAccess(repository, reader);
  }

  async execute(
    ctx: RoleContext,
    deliveryId: bigint,
    input: { status: 'DELIVERED' | 'LEAVE'; quantity?: number },
    meta: ActorMeta
  ): Promise<MarkDeliveryResultDto> {
    const correlationId = crypto.randomUUID();
    const record = await this.repository.findById(deliveryId, ctx.vendorId);
    if (!record) throw new DeliveryNotFoundError();

    const requiredGrant =
      input.status === 'LEAVE' ? PermissionKey.MARK_LEAVES : PermissionKey.MARK_DELIVERIES;
    await this.access.assertListPermission(ctx, record.supplyListId, requiredGrant);

    const total = await this.repository.getExtraChargesTotal(deliveryId);
    const entity = DailySupplyMapper.toDomain(record, total);
    const actor = this.access.actorRole(ctx);

    if (input.status === 'DELIVERED') {
      entity.markDelivered(actor, ctx.userId, input.quantity);
    } else {
      entity.markLeave(actor, ctx.userId);
    }
    const override = entity.consumePendingOverride();
    if (!override) throw new InternalServerError('Mark produced no override');

    try {
      await this.repository.applyMark(entity, override);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'markDelivery: persist failed');
      throw new InternalServerError('Failed to mark delivery. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.DELIVERY_MARKED,
      entityType: 'daily_supply',
      entityId: deliveryId,
      metadata: { status: input.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    const dto = await this.access.buildDeliveryDto(entity, ctx);
    return { delivery: dto, hasConflict: dto.hasConflict };
  }
}
