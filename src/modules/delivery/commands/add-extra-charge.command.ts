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
import { ExtraChargeResultDto } from '../delivery.types';

/** Command: add an extra charge to a daily supply and recompute its final amount. */
export class AddExtraChargeCommand {
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
    input: { dailySupplyId: bigint; amount: number; comment: string },
    meta: ActorMeta
  ): Promise<ExtraChargeResultDto> {
    const correlationId = crypto.randomUUID();
    const record = await this.repository.findById(input.dailySupplyId, ctx.vendorId);
    if (!record) throw new DeliveryNotFoundError();

    await this.access.assertListPermission(
      ctx,
      record.supplyListId,
      PermissionKey.ADD_EXTRA_CHARGES
    );

    const total = await this.repository.getExtraChargesTotal(input.dailySupplyId);
    const entity = DailySupplyMapper.toDomain(record, total);
    entity.addExtraCharge(input.amount); // throws ChargeOnNonDeliverableError on LEAVE/CANCELLED
    const newFinal = entity.getProps().finalAmount;
    const actor = this.access.actorRole(ctx);

    let charge: { id: bigint; createdAt: Date };
    try {
      charge = await this.repository.insertExtraCharge({
        dailySupplyId: input.dailySupplyId,
        amount: Math.round(input.amount * 100) / 100,
        comment: input.comment,
        addedByUserId: ctx.userId,
        addedByRole: actor,
        newFinalAmount: newFinal,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'addExtraCharge: persist failed');
      throw new InternalServerError('Failed to add extra charge. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.EXTRA_CHARGE_ADDED,
      entityType: 'supply_extra_charge',
      entityId: charge.id,
      metadata: { dailySupplyId: input.dailySupplyId.toString(), amount: input.amount },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return {
      id: charge.id.toString(),
      dailySupplyId: input.dailySupplyId.toString(),
      amount: Math.round(input.amount * 100) / 100,
      comment: input.comment,
      addedBy: { userId: ctx.userId.toString(), name: null, role: ctx.role },
      createdAt: charge.createdAt.toISOString(),
    };
  }
}
