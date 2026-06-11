import { Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import { SubscriptionEntity } from '../domain/subscription.entity';
import {
  ISubscriptionRepository,
  ListSubscriptionsParams,
  SubscriptionRecord,
} from './subscription.repository.port';

export class SubscriptionRepository implements ISubscriptionRepository {
  private client(tx?: PrismaTransaction) {
    return (tx ?? prisma).supplyListCustomer;
  }

  async findById(
    id: bigint,
    vendorId: bigint,
    supplyListId: bigint,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRecord | null> {
    return this.client(tx).findFirst({
      where: { id, vendorId, supplyListId },
    });
  }

  async list(
    supplyListId: bigint,
    vendorId: bigint,
    params: ListSubscriptionsParams,
    tx?: PrismaTransaction
  ): Promise<{ rows: SubscriptionRecord[]; total: number }> {
    const where: Prisma.SupplyListCustomerWhereInput = { supplyListId, vendorId };
    if (params.status === 'active') {
      where.isActive = true;
      where.endDate = null;
    } else if (params.status === 'paused') {
      where.isActive = false;
      where.endDate = null;
    } else if (params.status === 'ended') {
      where.endDate = { not: null };
    }
    if (params.customerIds !== undefined) {
      where.customerId = { in: params.customerIds };
    }

    const client = this.client(tx);
    const [rows, total] = await Promise.all([
      client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      client.count({ where }),
    ]);
    return { rows, total };
  }

  // "Non-ended" = endDate IS NULL: includes both ACTIVE and PAUSED subscriptions.
  async findNonEndedSubscriptionCustomerIds(
    supplyListId: bigint,
    tx?: PrismaTransaction
  ): Promise<bigint[]> {
    const rows = await this.client(tx).findMany({
      where: { supplyListId, endDate: null, deletedAt: null },
      select: { customerId: true },
    });
    return rows.map((r) => r.customerId);
  }

  async insertMany(
    entities: SubscriptionEntity[],
    tx?: PrismaTransaction
  ): Promise<SubscriptionRecord[]> {
    const run = async (client: PrismaTransaction): Promise<SubscriptionRecord[]> => {
      const created: SubscriptionRecord[] = [];
      for (const entity of entities) {
        const props = entity.getProps();
        const row = await client.supplyListCustomer.create({
          data: {
            vendorId: props.vendorId,
            supplyListId: props.supplyListId,
            customerId: props.customerId,
            customQuantity: props.customQuantity,
            customRatePerUnit: props.customRatePerUnit,
            startDate: props.startDate,
            isActive: props.isActive,
          },
        });
        created.push(row);
      }
      return created;
    };

    try {
      if (tx) return await run(tx);
      return await prisma.$transaction((c) => run(c as unknown as PrismaTransaction));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Customer is already subscribed to this list');
      }
      throw error;
    }
  }

  async updatePricing(
    id: bigint,
    data: { customQuantity?: number | null; customRatePerUnit?: number | null },
    tx?: PrismaTransaction
  ): Promise<SubscriptionRecord> {
    return this.client(tx).update({
      where: { id },
      data: {
        ...(data.customQuantity !== undefined ? { customQuantity: data.customQuantity } : {}),
        ...(data.customRatePerUnit !== undefined
          ? { customRatePerUnit: data.customRatePerUnit }
          : {}),
      },
    });
  }

  async updateActive(
    id: bigint,
    isActive: boolean,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRecord> {
    return this.client(tx).update({ where: { id }, data: { isActive } });
  }

  async end(id: bigint, endDate: Date, tx?: PrismaTransaction): Promise<SubscriptionRecord> {
    return this.client(tx).update({
      where: { id },
      data: { endDate, isActive: false },
    });
  }

  async otherListNamesFor(
    vendorId: bigint,
    customerIds: bigint[],
    excludeListId: bigint,
    tx?: PrismaTransaction
  ): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (customerIds.length === 0) return map;
    const rows = await this.client(tx).findMany({
      where: {
        vendorId,
        customerId: { in: customerIds },
        supplyListId: { not: excludeListId },
        endDate: null,
        deletedAt: null,
        supplyList: { isActive: true, deletedAt: null },
      },
      select: { customerId: true, supplyList: { select: { name: true } } },
    });
    for (const r of rows) {
      const list = map.get(r.customerId.toString()) ?? [];
      list.push(r.supplyList.name);
      map.set(r.customerId.toString(), list);
    }
    return map;
  }
}
