import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import {
  DailySupplyMapper,
  DateRange,
  LeaveEntity,
  NoActiveSubscriptionError,
} from '../delivery.domain';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { ActorMeta, DeliveryAccess } from '../delivery.shared';
import { CreateLeaveResultDto } from '../delivery.types';

/** Command: record a planned leave across one or more lists and pre-mark in-range supplies. */
export class CreateLeaveCommand {
  private readonly access: DeliveryAccess;

  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {
    this.access = new DeliveryAccess(repository, reader);
  }

  async execute(
    ctx: RoleContext,
    input: {
      customerId: bigint;
      supplyListIds: bigint[];
      startDate: Date;
      endDate: Date;
      reason: string | null;
    },
    meta: ActorMeta
  ): Promise<CreateLeaveResultDto> {
    const correlationId = crypto.randomUUID();
    for (const listId of input.supplyListIds) {
      await this.access.assertListPermission(ctx, listId, PermissionKey.MARK_LEAVES);
    }

    const subscriptions = await this.reader.resolveSubscriptions(
      ctx.vendorId,
      input.customerId,
      input.supplyListIds
    );
    if (subscriptions.length === 0) throw new NoActiveSubscriptionError();

    const range = DateRange.create(input.startDate, input.endDate);
    const leaveType =
      ctx.role === 'owner' || ctx.role === 'staff' ? 'VENDOR_MARKED' : 'CUSTOMER_REQUESTED';
    const actor = this.access.actorRole(ctx);

    let affected = 0;
    const leaves: CreateLeaveResultDto['leaves'] = [];

    try {
      await this.repository.transaction(async (tx) => {
        for (const sub of subscriptions) {
          const leave = LeaveEntity.create({
            supplyListCustomerId: sub.subscriptionId,
            startDate: input.startDate,
            endDate: input.endDate,
            leaveType,
            reason: input.reason,
            createdByUserId: ctx.userId,
          });
          const created = await this.repository.insertLeave(leave, tx);
          leaves.push({
            id: created.id.toString(),
            customerId: input.customerId.toString(),
            supplyListId: sub.supplyListId.toString(),
            startDate: range.startDate.toIso(),
            endDate: range.endDate.toIso(),
            leaveType,
          });

          const supplies = await this.repository.findBySubscriptionInRange(
            sub.subscriptionId,
            range.startDate.value,
            range.endDate.value,
            tx
          );
          for (const record of supplies) {
            if (record.status === 'LEAVE' || record.status === 'CANCELLED') continue;
            const total = await this.repository.getExtraChargesTotal(record.id, tx);
            const entity = DailySupplyMapper.toDomain(record, total);
            entity.markLeave(actor, ctx.userId);
            const override = entity.consumePendingOverride();
            if (override) {
              await this.repository.applyMark(entity, override, tx);
              affected += 1;
            }
          }
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'createLeave: persist failed');
      throw new InternalServerError('Failed to record leave. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.LEAVE_MARKED,
      entityType: 'leave',
      entityId: input.customerId,
      metadata: { created: leaves.length, affectedDeliveries: affected },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return { created: leaves.length, leaves, affectedDeliveries: affected };
  }
}
