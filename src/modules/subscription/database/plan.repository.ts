/**
 * Prisma adapter for ISubscriptionPlanRepository.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { SubscriptionPlanEntity } from '../domain/plan.entity';
import { ISubscriptionPlanRepository } from './plan.repository.port';

function toPlanEntity(row: {
  id: bigint;
  planName: string;
  planCode: string;
  priceMonthly: { toNumber(): number };
  priceYearly: { toNumber(): number } | null;
  maxCustomers: number;
  maxStaff: number;
  maxSupplyLists: number;
  features: unknown;
  isActive: boolean;
}): SubscriptionPlanEntity {
  return SubscriptionPlanEntity.fromPersistence({
    id: row.id,
    planName: row.planName,
    planCode: row.planCode,
    priceMonthly: row.priceMonthly.toNumber(),
    priceYearly: row.priceYearly?.toNumber() ?? null,
    maxCustomers: row.maxCustomers,
    maxStaff: row.maxStaff,
    maxSupplyLists: row.maxSupplyLists,
    features: (row.features as Record<string, boolean> | null) ?? null,
    isActive: row.isActive,
  });
}

export class PlanRepository implements ISubscriptionPlanRepository {
  async findAllActive(): Promise<SubscriptionPlanEntity[]> {
    const rows = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    return rows.map(toPlanEntity);
  }

  async findActiveById(id: bigint): Promise<SubscriptionPlanEntity | null> {
    const row = await prisma.subscriptionPlan.findFirst({
      where: { id, isActive: true },
    });
    return row ? toPlanEntity(row) : null;
  }

  async findByCode(code: string): Promise<SubscriptionPlanEntity | null> {
    const row = await prisma.subscriptionPlan.findFirst({
      where: { planCode: code, isActive: true },
    });
    return row ? toPlanEntity(row) : null;
  }
}
