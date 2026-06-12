import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import { DailySupplyMapper } from '../delivery.domain';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { ActorMeta, DeliveryAccess } from '../delivery.shared';
import { MarkBulkResultDto } from '../delivery.types';

/** Command: bulk-mark every pending delivery in a list for a date as DELIVERED. */
export class MarkBulkDeliveryCommand {
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
    input: { supplyListId: bigint; date: Date; excludeDeliveryIds: bigint[] },
    meta: ActorMeta
  ): Promise<MarkBulkResultDto> {
    const correlationId = crypto.randomUUID();
    await this.access.assertListPermission(ctx, input.supplyListId, PermissionKey.MARK_DELIVERIES);

    const ids = await this.repository.findMarkableIds(
      ctx.vendorId,
      input.supplyListId,
      input.date,
      input.excludeDeliveryIds
    );
    const actor = this.access.actorRole(ctx);

    let updated = 0;
    try {
      await this.repository.transaction(async (tx) => {
        for (const id of ids) {
          const record = await this.repository.findById(id, ctx.vendorId, tx);
          if (!record) continue;
          const total = await this.repository.getExtraChargesTotal(id, tx);
          const entity = DailySupplyMapper.toDomain(record, total);
          entity.markDelivered(actor, ctx.userId);
          const override = entity.consumePendingOverride();
          if (override) {
            await this.repository.applyMark(entity, override, tx);
            updated += 1;
          }
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'markBulk: persist failed');
      throw new InternalServerError('Failed to bulk-mark deliveries. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.DELIVERIES_BULK_MARKED,
      entityType: 'supply_list',
      entityId: input.supplyListId,
      metadata: { updated, date: input.date.toISOString().slice(0, 10) },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return { updated, skipped: input.excludeDeliveryIds.length };
  }
}
