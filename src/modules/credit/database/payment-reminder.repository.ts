import { prisma } from '@/infrastructure/database/prisma.client';
import { Prisma } from '@prisma/client';
import { PaymentReminderEntity } from '../domain/payment-reminder.entity';
import {
  ReminderChannelEnum,
  ReminderStatusEnum,
  ReminderResponseTypeEnum,
} from '../domain/credit.types';
import { IPaymentReminderRepository, ReminderHistoryRow } from './payment-reminder.repository.port';
import { ConflictError } from '@/common/errors/app-error';

export class PaymentReminderRepository implements IPaymentReminderRepository {
  async insert(entity: PaymentReminderEntity): Promise<PaymentReminderEntity> {
    const p = entity.getProps();
    try {
      const row = await prisma.paymentReminder.create({
        data: {
          customerId: p.customerId,
          vendorId: p.vendorId,
          amountDue: p.amountDue,
          reminderDate: p.reminderDate,
          sentVia: p.sentVia,
          status: p.status,
          responseType: p.responseType ?? null,
          responseAmount: p.responseAmount !== null ? p.responseAmount : null,
        },
      });

      return PaymentReminderEntity.reconstitute({
        id: row.id,
        createdAt: row.createdAt,
        props: {
          customerId: row.customerId,
          vendorId: row.vendorId,
          amountDue: Number(row.amountDue.toString()),
          reminderDate: row.reminderDate,
          sentVia: row.sentVia as ReminderChannelEnum,
          status: row.status as ReminderStatusEnum,
          responseType: row.responseType ? (row.responseType as ReminderResponseTypeEnum) : null,
          responseAmount: row.responseAmount ? Number(row.responseAmount.toString()) : null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('A reminder already exists for this customer today');
      }
      throw err;
    }
  }

  async existsForDate(customerId: bigint, date: Date): Promise<boolean> {
    // Normalize to date-only for comparison
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const count = await prisma.paymentReminder.count({
      where: {
        customerId,
        reminderDate: dateOnly,
      },
    });
    return count > 0;
  }

  async listByCustomer(
    customerId: bigint,
    vendorId: bigint,
    page: number,
    limit: number
  ): Promise<{ rows: ReminderHistoryRow[]; total: number }> {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      prisma.paymentReminder.findMany({
        where: { customerId, vendorId },
        orderBy: { reminderDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.paymentReminder.count({ where: { customerId, vendorId } }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        amountDue: Number(r.amountDue.toString()),
        reminderDate: r.reminderDate,
        sentVia: r.sentVia,
        status: r.status,
        responseType: r.responseType ?? null,
        responseAmount: r.responseAmount ? Number(r.responseAmount.toString()) : null,
        createdAt: r.createdAt,
      })),
      total,
    };
  }

  async countByCustomer(customerId: bigint, vendorId: bigint): Promise<number> {
    return prisma.paymentReminder.count({ where: { customerId, vendorId } });
  }

  async successRateByCustomer(customerId: bigint, vendorId: bigint): Promise<number> {
    const [total, delivered] = await Promise.all([
      prisma.paymentReminder.count({ where: { customerId, vendorId } }),
      prisma.paymentReminder.count({ where: { customerId, vendorId, status: 'DELIVERED' } }),
    ]);
    if (total === 0) return 0;
    return Math.round((delivered / total) * 100);
  }
}
