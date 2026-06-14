import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';

export interface IDeliveryActionPort {
  resolveDeliveryId(
    vendorId: bigint,
    supplyListId: bigint,
    customerId: bigint,
    serviceDate: Date
  ): Promise<bigint | null>;

  markDelivery(
    ctx: { userId: bigint; vendorId: bigint; correlationId: string; roleCtx: RoleContext },
    deliveryId: bigint,
    status: 'DELIVERED' | 'LEAVE',
    meta?: Record<string, unknown>
  ): Promise<void>;

  markAllPending(
    ctx: { userId: bigint; vendorId: bigint; correlationId: string; roleCtx: RoleContext },
    supplyListId: bigint,
    serviceDate: Date,
    meta?: Record<string, unknown>
  ): Promise<{ markedCount: number }>;
}
