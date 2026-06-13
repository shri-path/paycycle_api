/**
 * ReminderTargetAdapter — Prisma implementation of ReminderTargetPort.
 * Queries Customer records filtered by vendor membership.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import { ReminderTarget, ReminderTargetPort } from '../ports/reminder-target.port';

export class ReminderTargetAdapter implements ReminderTargetPort {
  async resolveCustomers(
    vendorId: bigint,
    customerIds?: bigint[],
    all?: boolean
  ): Promise<ReminderTarget[]> {
    if (!all && (!customerIds || customerIds.length === 0)) {
      return [];
    }

    const where: Prisma.CustomerWhereInput = {
      vendorCustomers: { some: { vendorId, status: 'ACTIVE', deletedAt: null } },
      deletedAt: null,
    };

    if (!all && customerIds && customerIds.length > 0) {
      where.id = { in: customerIds };
    }

    const customers = await prisma.customer.findMany({
      where,
      select: { id: true, phone: true },
    });

    return customers.map((c) => ({ customerId: c.id, phone: c.phone }));
  }
}
