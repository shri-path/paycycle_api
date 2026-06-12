import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, ForbiddenError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import { DailySupplyMapper, LeaveNotFoundError } from '../delivery.domain';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { ActorMeta, DeliveryAccess, appToday } from '../delivery.shared';

/** Command: cancel a future leave and revert covered LEAVE supplies to PENDING. */
export class CancelLeaveCommand {
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
    leaveId: bigint,
    meta: ActorMeta
  ): Promise<{ revertedDeliveries: number }> {
    const correlationId = crypto.randomUUID();
    const leave = await this.repository.findLeaveById(leaveId);
    if (!leave) throw new LeaveNotFoundError();

    // Tenant + permission: resolve the subscription's list and check the grant.
    const customers = await this.reader.getSubscriptionCustomerIds([leave.supplyListCustomerId]);
    if (customers.size === 0) throw new LeaveNotFoundError();

    const supplies = await this.repository.findBySubscriptionInRange(
      leave.supplyListCustomerId,
      leave.startDate,
      leave.endDate
    );
    // Permission: the leave's list — derive from any covered supply, else allow owner.
    const listId = supplies[0]?.supplyListId;
    if (listId !== undefined) {
      await this.access.assertListPermission(ctx, listId, PermissionKey.MARK_LEAVES);
    } else if (ctx.role !== 'owner') {
      throw new ForbiddenError('You do not have permission to cancel this leave');
    }

    const today = appToday();
    if (leave.endDate.getTime() < today.getTime()) {
      throw new LeaveNotFoundError('Only future leaves can be cancelled');
    }

    let reverted = 0;
    const actor = this.access.actorRole(ctx);
    try {
      await this.repository.transaction(async (tx) => {
        await this.repository.deleteLeave(leaveId, tx);
        for (const record of supplies) {
          if (record.status !== 'LEAVE') continue;
          if (record.serviceDate.getTime() < today.getTime()) continue;
          const covered = await this.repository.countCoveringLeaves(
            leave.supplyListCustomerId,
            record.serviceDate,
            leaveId,
            tx
          );
          if (covered > 0) continue;
          const total = await this.repository.getExtraChargesTotal(record.id, tx);
          const entity = DailySupplyMapper.toDomain(record, total);
          entity.revertToPending(actor, ctx.userId);
          const override = entity.consumePendingOverride();
          if (override) {
            await this.repository.applyMark(entity, override, tx);
            reverted += 1;
          }
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'cancelLeave: persist failed');
      throw new InternalServerError('Failed to cancel leave. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.LEAVE_CANCELLED,
      entityType: 'leave',
      entityId: leaveId,
      metadata: { revertedDeliveries: reverted },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return { revertedDeliveries: reverted };
  }
}
