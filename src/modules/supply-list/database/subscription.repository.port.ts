import { SupplyListCustomer } from '@prisma/client';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { SubscriptionEntity } from '../domain/subscription.entity';

export type SubscriptionRecord = SupplyListCustomer;

export interface ListSubscriptionsParams {
  /** 'active' | 'paused' | 'ended' filter. */
  status?: 'active' | 'paused' | 'ended';
  /** customerIds to restrict to (after a name/phone search resolves them). */
  customerIds?: bigint[];
  skip: number;
  take: number;
}

export interface ISubscriptionRepository {
  /** Tenant + list scoped fetch. Null for wrong tenant/list (mask 404). */
  findById(
    id: bigint,
    vendorId: bigint,
    supplyListId: bigint,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRecord | null>;

  list(
    supplyListId: bigint,
    vendorId: bigint,
    params: ListSubscriptionsParams,
    tx?: PrismaTransaction
  ): Promise<{ rows: SubscriptionRecord[]; total: number }>;

  /**
   * Customer ids with a non-ended subscription on the list — deduped.
   * "Non-ended" = endDate IS NULL, i.e. ACTIVE or PAUSED (not isActive=true only).
   */
  findNonEndedSubscriptionCustomerIds(
    supplyListId: bigint,
    tx?: PrismaTransaction
  ): Promise<bigint[]>;

  /** Insert many subscriptions atomically; returns the created records. */
  insertMany(entities: SubscriptionEntity[], tx?: PrismaTransaction): Promise<SubscriptionRecord[]>;

  /** Focused pricing/override update. */
  updatePricing(
    id: bigint,
    data: { customQuantity?: number | null; customRatePerUnit?: number | null },
    tx?: PrismaTransaction
  ): Promise<SubscriptionRecord>;

  /** Status flip (active ⇄ paused) via isActive. */
  updateActive(id: bigint, isActive: boolean, tx?: PrismaTransaction): Promise<SubscriptionRecord>;

  /** End: endDate=today, isActive=false. */
  end(id: bigint, endDate: Date, tx?: PrismaTransaction): Promise<SubscriptionRecord>;

  /**
   * For a set of customers, the active list-name memberships keyed by customerId
   * (used to build `otherLists`). Excludes the given list. Batched, no N+1.
   */
  otherListNamesFor(
    vendorId: bigint,
    customerIds: bigint[],
    excludeListId: bigint,
    tx?: PrismaTransaction
  ): Promise<Map<string, string[]>>;
}
