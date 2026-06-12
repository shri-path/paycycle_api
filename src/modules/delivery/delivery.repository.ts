import { Prisma, DailySupplyStatus, ActorRole } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import {
  DailySupplyEntity,
  DailySupplyRecord,
  LeaveEntity,
  OverrideProps,
} from './delivery.domain';
import {
  DailySupplyInsert,
  IDeliveryRepository,
  LeaveRecord,
  OverrideRow,
} from './delivery.repository.port';

function toNum(d: Prisma.Decimal | null): number {
  return d === null ? 0 : Number(d.toString());
}

export class DeliveryRepository implements IDeliveryRepository {
  private db(tx?: PrismaTransaction) {
    return tx ?? prisma;
  }

  async findById(
    id: bigint,
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<DailySupplyRecord | null> {
    return this.db(tx).dailySupply.findFirst({ where: { id, vendorId } });
  }

  async getExtraChargesTotal(dailySupplyId: bigint, tx?: PrismaTransaction): Promise<number> {
    const agg = await this.db(tx).supplyExtraCharge.aggregate({
      where: { dailySupplyId },
      _sum: { amount: true },
    });
    return toNum(agg._sum.amount);
  }

  async listByListAndDate(
    vendorId: bigint,
    supplyListId: bigint,
    serviceDate: Date,
    filters: { status?: DailySupplyStatus; search?: string },
    tx?: PrismaTransaction
  ): Promise<DailySupplyRecord[]> {
    const where: Prisma.DailySupplyWhereInput = { vendorId, supplyListId, serviceDate };
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      where.subscription = {
        customer: {
          OR: [
            { name: { contains: filters.search, mode: 'insensitive' } },
            { phone: { contains: filters.search } },
          ],
        },
      };
    }
    return this.db(tx).dailySupply.findMany({ where, orderBy: { id: 'asc' } });
  }

  async findMarkableIds(
    vendorId: bigint,
    supplyListId: bigint,
    serviceDate: Date,
    excludeIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<bigint[]> {
    const where: Prisma.DailySupplyWhereInput = {
      vendorId,
      supplyListId,
      serviceDate,
      status: { in: [DailySupplyStatus.PENDING, DailySupplyStatus.AUTO_MARKED] },
    };
    if (excludeIds.length > 0) where.id = { notIn: excludeIds };
    const rows = await this.db(tx).dailySupply.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async findPendingIdsForDate(
    serviceDate: Date,
    options?: { minQuantity?: number },
    tx?: PrismaTransaction
  ): Promise<bigint[]> {
    const where: Prisma.DailySupplyWhereInput = {
      serviceDate,
      status: DailySupplyStatus.PENDING,
    };
    if (options?.minQuantity !== undefined) {
      where.quantity = { gt: options.minQuantity };
    }
    const rows = await this.db(tx).dailySupply.findMany({ where, select: { id: true } });
    return rows.map((r) => r.id);
  }

  async findByIds(ids: bigint[], tx?: PrismaTransaction): Promise<DailySupplyRecord[]> {
    if (ids.length === 0) return [];
    return this.db(tx).dailySupply.findMany({ where: { id: { in: ids } } });
  }

  async applyMark(
    entity: DailySupplyEntity,
    override: OverrideProps,
    tx?: PrismaTransaction
  ): Promise<void> {
    const run = async (client: PrismaTransaction): Promise<void> => {
      const props = entity.getProps();
      await client.dailySupply.update({
        where: { id: props.id },
        data: {
          status: props.status,
          quantity: props.quantity,
          baseAmount: props.baseAmount,
          finalAmount: props.finalAmount,
          isAutoMarked: props.isAutoMarked,
          markedByUserId: props.markedByUserId,
          markedAt: props.markedAt,
        },
      });
      await client.supplyOverride.create({
        data: {
          dailySupplyId: props.id,
          changedByUserId: override.changedByUserId,
          actorRole: override.actorRole,
          previousStatus: override.previousStatus,
          newStatus: override.newStatus,
          previousQuantity: override.previousQuantity,
          newQuantity: override.newQuantity,
          comment: override.comment,
        },
      });
    };
    if (tx) return run(tx);
    return this.transaction(run);
  }

  async insertGenerated(rows: DailySupplyInsert[], tx?: PrismaTransaction): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await this.db(tx).dailySupply.createMany({
      data: rows.map((r) => ({
        vendorId: r.vendorId,
        supplyListCustomerId: r.supplyListCustomerId,
        supplyListId: r.supplyListId,
        serviceDate: r.serviceDate,
        status: r.status,
        quantity: r.quantity,
        unit: r.unit,
        ratePerUnit: r.ratePerUnit,
        baseAmount: r.baseAmount,
        finalAmount: r.finalAmount,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async findBySubscriptionInRange(
    supplyListCustomerId: bigint,
    startDate: Date,
    endDate: Date,
    tx?: PrismaTransaction
  ): Promise<DailySupplyRecord[]> {
    return this.db(tx).dailySupply.findMany({
      where: { supplyListCustomerId, serviceDate: { gte: startDate, lte: endDate } },
      orderBy: { serviceDate: 'asc' },
    });
  }

  async findOverridesFor(dailySupplyIds: bigint[], tx?: PrismaTransaction): Promise<OverrideRow[]> {
    if (dailySupplyIds.length === 0) return [];
    const rows = await this.db(tx).supplyOverride.findMany({
      where: { dailySupplyId: { in: dailySupplyIds } },
      select: {
        dailySupplyId: true,
        actorRole: true,
        newStatus: true,
        changedByUserId: true,
        createdAt: true,
      },
    });
    return rows;
  }

  async insertExtraCharge(
    input: {
      dailySupplyId: bigint;
      amount: number;
      comment: string;
      addedByUserId: bigint | null;
      addedByRole: ActorRole | null;
      newFinalAmount: number;
    },
    tx?: PrismaTransaction
  ): Promise<{ id: bigint; createdAt: Date }> {
    const run = async (client: PrismaTransaction): Promise<{ id: bigint; createdAt: Date }> => {
      const charge = await client.supplyExtraCharge.create({
        data: {
          dailySupplyId: input.dailySupplyId,
          amount: input.amount,
          comment: input.comment,
          addedByUserId: input.addedByUserId,
          addedByRole: input.addedByRole,
        },
        select: { id: true, createdAt: true },
      });
      await client.dailySupply.update({
        where: { id: input.dailySupplyId },
        data: { finalAmount: input.newFinalAmount },
      });
      return charge;
    };
    if (tx) return run(tx);
    return this.transaction(run);
  }

  async findLeaveById(id: bigint, tx?: PrismaTransaction): Promise<LeaveRecord | null> {
    const row = await this.db(tx).leave.findUnique({ where: { id } });
    return row as LeaveRecord | null;
  }

  async insertLeave(entity: LeaveEntity, tx?: PrismaTransaction): Promise<{ id: bigint }> {
    const props = entity.getProps();
    try {
      const created = await this.db(tx).leave.create({
        data: {
          supplyListCustomerId: props.supplyListCustomerId,
          startDate: props.range.startDate.value,
          endDate: props.range.endDate.value,
          leaveType: props.leaveType,
          reason: props.reason,
          createdByUserId: props.createdByUserId,
        },
        select: { id: true },
      });
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Leave already exists for this period');
      }
      throw error;
    }
  }

  async deleteLeave(id: bigint, tx?: PrismaTransaction): Promise<void> {
    await this.db(tx).leave.delete({ where: { id } });
  }

  async countCoveringLeaves(
    supplyListCustomerId: bigint,
    date: Date,
    excludeLeaveId: bigint | null,
    tx?: PrismaTransaction
  ): Promise<number> {
    const where: Prisma.LeaveWhereInput = {
      supplyListCustomerId,
      startDate: { lte: date },
      endDate: { gte: date },
    };
    if (excludeLeaveId !== null) where.id = { not: excludeLeaveId };
    return this.db(tx).leave.count({ where });
  }

  async hasLeaveCovering(
    supplyListCustomerId: bigint,
    date: Date,
    tx?: PrismaTransaction
  ): Promise<boolean> {
    return (await this.countCoveringLeaves(supplyListCustomerId, date, null, tx)) > 0;
  }

  async listLeaves(
    vendorId: bigint,
    params: { from: Date; to: Date; supplyListCustomerIds?: bigint[] },
    tx?: PrismaTransaction
  ): Promise<LeaveRecord[]> {
    const where: Prisma.LeaveWhereInput = {
      subscription: { vendorId },
      // Overlapping window: leave.start <= to AND leave.end >= from.
      startDate: { lte: params.to },
      endDate: { gte: params.from },
    };
    if (params.supplyListCustomerIds !== undefined) {
      where.supplyListCustomerId = { in: params.supplyListCustomerIds };
    }
    const rows = await this.db(tx).leave.findMany({
      where,
      orderBy: { startDate: 'asc' },
    });
    return rows as LeaveRecord[];
  }

  async transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T> {
    return prisma.$transaction((c) => fn(c as unknown as PrismaTransaction));
  }
}
