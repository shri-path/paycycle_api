/**
 * BulkLeaveWriterAdapter — Prisma implementation of BulkLeaveWriterPort.
 * Touches Leave, DailySupply, SupplyListCustomer models.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { BulkLeaveWriterPort } from '../ports/bulk-leave-writer.port';

/** Return today's date as "YYYY-MM-DD" in Asia/Kolkata. */
function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

export class BulkLeaveWriterAdapter implements BulkLeaveWriterPort {
  async resolveSubscriptions(
    vendorId: bigint,
    mode: 'all' | 'specific',
    ids?: bigint[]
  ): Promise<bigint[]> {
    if (mode === 'all') {
      const subs = await prisma.supplyListCustomer.findMany({
        where: { vendorId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      return subs.map((s) => s.id);
    }

    if (!ids || ids.length === 0) return [];

    const subs = await prisma.supplyListCustomer.findMany({
      where: { id: { in: ids }, vendorId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    return subs.map((s) => s.id);
  }

  async hasCoveringLeave(subscriptionId: bigint, date: string): Promise<boolean> {
    const d = new Date(date);
    const existing = await prisma.leave.findFirst({
      where: {
        supplyListCustomerId: subscriptionId,
        startDate: { lte: d },
        endDate: { gte: d },
      },
    });
    return existing !== null;
  }

  async createLeave(
    subscriptionId: bigint,
    date: string,
    reason: string | null,
    _source: 'VENDOR_MARKED',
    userId: bigint
  ): Promise<void> {
    const d = new Date(date);
    await prisma.leave.create({
      data: {
        supplyListCustomerId: subscriptionId,
        startDate: d,
        endDate: d,
        leaveType: 'VENDOR_MARKED',
        ...(reason !== null ? { reason } : {}),
        createdByUserId: userId,
      },
    });
  }

  async markDeliveriesLeave(subscriptionId: bigint, date: string): Promise<number> {
    const d = new Date(date);
    const result = await prisma.dailySupply.updateMany({
      where: {
        supplyListCustomerId: subscriptionId,
        serviceDate: d,
        status: { not: 'LEAVE' },
      },
      data: { status: 'LEAVE' },
    });
    return result.count;
  }

  today(): string {
    return todayIST();
  }
}
