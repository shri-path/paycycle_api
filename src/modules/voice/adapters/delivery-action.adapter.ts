/**
 * DeliveryActionAdapter — ACL adapter that delegates to the Delivery aggregate.
 * Wraps MarkDeliveryCommand / MarkBulkDeliveryCommand; does NOT re-implement marking.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { IDeliveryActionPort } from '../ports/delivery-action.port';
import { MarkDeliveryCommand } from '@/modules/delivery/commands/mark-delivery.command';
import { MarkBulkDeliveryCommand } from '@/modules/delivery/commands/mark-bulk-delivery.command';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';

export class DeliveryActionAdapter implements IDeliveryActionPort {
  constructor(
    private readonly markCmd: MarkDeliveryCommand,
    private readonly bulkMarkCmd: MarkBulkDeliveryCommand
  ) {}

  async resolveDeliveryId(
    vendorId: bigint,
    supplyListId: bigint,
    customerId: bigint,
    serviceDate: Date
  ): Promise<bigint | null> {
    // Find the supply_list_customer for this customer+list, then find today's DailySupply
    const subscription = await prisma.supplyListCustomer.findFirst({
      where: { vendorId, supplyListId, customerId, isActive: true, deletedAt: null },
    });
    if (!subscription) return null;

    const daily = await prisma.dailySupply.findFirst({
      where: {
        vendorId,
        supplyListId,
        supplyListCustomerId: subscription.id,
        serviceDate,
      },
    });
    return daily?.id ?? null;
  }

  async markDelivery(
    ctx: { userId: bigint; vendorId: bigint; correlationId: string; roleCtx: RoleContext },
    deliveryId: bigint,
    status: 'DELIVERED' | 'LEAVE',
    _meta?: Record<string, unknown>
  ): Promise<void> {
    const actorMeta = { ip: null, userAgent: null };
    await this.markCmd.execute(ctx.roleCtx, deliveryId, { status }, actorMeta);
  }

  async markAllPending(
    ctx: { userId: bigint; vendorId: bigint; correlationId: string; roleCtx: RoleContext },
    supplyListId: bigint,
    serviceDate: Date,
    _meta?: Record<string, unknown>
  ): Promise<{ markedCount: number }> {
    const actorMeta = { ip: null, userAgent: null };
    const result = await this.bulkMarkCmd.execute(
      ctx.roleCtx,
      { supplyListId, date: serviceDate, excludeDeliveryIds: [] },
      actorMeta
    );
    return { markedCount: result.updated };
  }
}
