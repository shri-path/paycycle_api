/**
 * DeliveryControlAdapter — idempotently pauses a customer's deliveries.
 * Sets vendor_customers.status = PAUSED.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { IDeliveryControlPort } from '../ports/delivery-control.port';

export class DeliveryControlAdapter implements IDeliveryControlPort {
  async pauseCustomer(customerId: bigint, vendorId: bigint): Promise<void> {
    await prisma.vendorCustomer.updateMany({
      where: { customerId, vendorId, deletedAt: null },
      data: { status: 'PAUSED' },
    });
  }
}
