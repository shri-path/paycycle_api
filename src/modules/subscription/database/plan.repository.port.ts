/**
 * ISubscriptionPlanRepository port — domain depends on this interface, not Prisma.
 */
import { SubscriptionPlanEntity } from '../domain/plan.entity';

export interface ISubscriptionPlanRepository {
  findAllActive(): Promise<SubscriptionPlanEntity[]>;
  findActiveById(id: bigint): Promise<SubscriptionPlanEntity | null>;
  findByCode(code: string): Promise<SubscriptionPlanEntity | null>;
}
