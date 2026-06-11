import { Prisma, SupplyFrequency } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import { SupplyListEntity } from '../domain/supply-list.entity';
import {
  AssignedStaffInfo,
  ISupplyListRepository,
  ListSupplyListsParams,
  SupplyListRecord,
} from './supply-list.repository.port';

const INCLUDE = {
  staff: true,
  schedule: true,
} satisfies Prisma.SupplyListInclude;

export class SupplyListRepository implements ISupplyListRepository {
  private client(tx?: PrismaTransaction) {
    return (tx ?? prisma).supplyList;
  }

  async findById(
    id: bigint,
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<SupplyListRecord | null> {
    return this.client(tx).findFirst({
      where: { id, vendorId },
      include: INCLUDE,
    }) as Promise<SupplyListRecord | null>;
  }

  async findActiveByName(
    vendorId: bigint,
    name: string,
    tx?: PrismaTransaction
  ): Promise<SupplyListRecord | null> {
    return this.client(tx).findFirst({
      where: {
        vendorId,
        isActive: true,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
      },
      include: INCLUDE,
    }) as Promise<SupplyListRecord | null>;
  }

  async list(
    vendorId: bigint,
    params: ListSupplyListsParams,
    tx?: PrismaTransaction
  ): Promise<{ rows: SupplyListRecord[]; total: number }> {
    const where: Prisma.SupplyListWhereInput = { vendorId };
    if (params.isActive !== undefined) {
      where.isActive = params.isActive;
      if (params.isActive) where.deletedAt = null;
    }
    if (params.assignedToVendorUserId !== undefined) {
      where.staff = { some: { vendorUserId: params.assignedToVendorUserId } };
    }

    const client = this.client(tx);
    const [rows, total] = await Promise.all([
      client.findMany({
        where,
        include: INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      client.count({ where }),
    ]);
    return { rows: rows as SupplyListRecord[], total };
  }

  async insert(entity: SupplyListEntity, tx?: PrismaTransaction): Promise<SupplyListRecord> {
    const props = entity.getProps();
    try {
      const created = await this.client(tx).create({
        data: {
          vendorId: props.vendorId,
          name: props.name,
          supplyType: props.supplyType,
          unit: props.unit,
          defaultQuantity: props.defaultQuantity,
          ratePerUnit: props.ratePerUnit,
          startTime: props.startTime,
          frequency: props.frequency,
          isActive: props.isActive,
          staff: {
            create: props.staff.map((s) => ({
              vendorUserId: s.vendorUserId,
              isPrimary: s.isPrimary,
              assignedByUserId: s.assignedByUserId,
              assignedAt: s.assignedAt,
            })),
          },
          schedule: {
            create: props.schedule.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              dayOfMonth: s.dayOfMonth,
            })),
          },
        },
        include: INCLUDE,
      });
      return created as SupplyListRecord;
    } catch (error) {
      throw translateP2002(error);
    }
  }

  async updateDetails(entity: SupplyListEntity, tx?: PrismaTransaction): Promise<SupplyListRecord> {
    const props = entity.getProps();
    const run = async (client: PrismaTransaction): Promise<SupplyListRecord> => {
      // Replace schedule rows to keep them consistent with the frequency.
      await client.supplyListSchedule.deleteMany({ where: { supplyListId: props.id } });
      const updated = await client.supplyList.update({
        where: { id: props.id },
        data: {
          name: props.name,
          supplyType: props.supplyType,
          unit: props.unit,
          defaultQuantity: props.defaultQuantity,
          ratePerUnit: props.ratePerUnit,
          startTime: props.startTime,
          frequency: props.frequency,
          ...(props.schedule.length > 0
            ? {
                schedule: {
                  create: props.schedule.map((s) => ({
                    dayOfWeek: s.dayOfWeek,
                    dayOfMonth: s.dayOfMonth,
                  })),
                },
              }
            : {}),
        },
        include: INCLUDE,
      });
      return updated as SupplyListRecord;
    };

    try {
      if (tx) return await run(tx);
      return await prisma.$transaction((c) => run(c as unknown as PrismaTransaction));
    } catch (error) {
      throw translateP2002(error);
    }
  }

  async archive(id: bigint, tx?: PrismaTransaction): Promise<void> {
    await this.client(tx).update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
  }

  async assignStaff(
    supplyListId: bigint,
    vendorUserId: bigint,
    isPrimary: boolean,
    assignedByUserId: bigint | null,
    tx?: PrismaTransaction
  ): Promise<void> {
    try {
      await (tx ?? prisma).supplyListStaff.create({
        data: { supplyListId, vendorUserId, isPrimary, assignedByUserId },
      });
    } catch (error) {
      throw translateP2002(error, 'Staff member is already assigned to this list');
    }
  }

  async unassignStaff(
    supplyListId: bigint,
    vendorUserId: bigint,
    tx?: PrismaTransaction
  ): Promise<void> {
    await (tx ?? prisma).supplyListStaff.deleteMany({ where: { supplyListId, vendorUserId } });
  }

  async demoteOtherPrimaries(
    supplyListId: bigint,
    keepVendorUserId: bigint,
    tx?: PrismaTransaction
  ): Promise<void> {
    await (tx ?? prisma).supplyListStaff.updateMany({
      where: { supplyListId, vendorUserId: { not: keepVendorUserId }, isPrimary: true },
      data: { isPrimary: false },
    });
  }

  async countActiveCustomers(
    supplyListIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (supplyListIds.length === 0) return map;
    const grouped = await (tx ?? prisma).supplyListCustomer.groupBy({
      by: ['supplyListId'],
      where: { supplyListId: { in: supplyListIds }, isActive: true, deletedAt: null },
      _count: { _all: true },
    });
    for (const g of grouped) {
      map.set(g.supplyListId.toString(), g._count._all);
    }
    return map;
  }

  async assignedStaffFor(
    supplyListIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<Map<string, AssignedStaffInfo[]>> {
    const map = new Map<string, AssignedStaffInfo[]>();
    if (supplyListIds.length === 0) return map;
    const rows = await (tx ?? prisma).supplyListStaff.findMany({
      where: { supplyListId: { in: supplyListIds } },
      include: {
        vendorUser: { select: { phone: true, user: { select: { name: true, phone: true } } } },
      },
      orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'asc' }],
    });
    for (const r of rows) {
      const list = map.get(r.supplyListId.toString()) ?? [];
      list.push({
        vendorUserId: r.vendorUserId,
        name: r.vendorUser.user?.name ?? null,
        phone: r.vendorUser.phone ?? r.vendorUser.user?.phone ?? null,
        isPrimary: r.isPrimary,
      });
      map.set(r.supplyListId.toString(), list);
    }
    return map;
  }

  scheduleDays(record: SupplyListRecord): number[] {
    if (record.frequency === SupplyFrequency.WEEKLY) {
      return record.schedule
        .map((s) => s.dayOfWeek)
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b);
    }
    if (record.frequency === SupplyFrequency.MONTHLY) {
      return record.schedule
        .map((s) => s.dayOfMonth)
        .filter((d): d is number => d !== null)
        .sort((a, b) => a - b);
    }
    return [];
  }

  async assignedListIdsFor(vendorUserId: bigint, tx?: PrismaTransaction): Promise<bigint[]> {
    const rows = await (tx ?? prisma).supplyListStaff.findMany({
      where: { vendorUserId },
      select: { supplyListId: true },
    });
    return rows.map((r) => r.supplyListId);
  }
}

function translateP2002(error: unknown, message = 'Record already exists'): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictError(message);
  }
  return error;
}
