import { ActorRole, DailySupplyStatus } from '@prisma/client';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';
import {
  DailySupplyEntity,
  DailySupplyRecord,
  LeaveEntity,
  OverrideProps,
} from './delivery.domain';

/** A subscription that should receive a daily supply on a given date. */
export interface ActiveSubscriptionForGeneration {
  subscriptionId: bigint;
  vendorId: bigint;
  supplyListId: bigint;
  customerId: bigint;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  frequency: string;
  frequencyDays: number[];
  startDate: Date | null;
  endDate: Date | null;
}

/** A new daily supply row to insert during generation. */
export interface DailySupplyInsert {
  vendorId: bigint;
  supplyListCustomerId: bigint;
  supplyListId: bigint;
  serviceDate: Date;
  status: DailySupplyStatus;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  baseAmount: number;
  finalAmount: number;
}

export interface LeaveRecord {
  id: bigint;
  supplyListCustomerId: bigint;
  startDate: Date;
  endDate: Date;
  leaveType: ActorRoleOrLeaveType;
  reason: string | null;
  createdByUserId: bigint | null;
  createdAt: Date;
}

type ActorRoleOrLeaveType = 'CUSTOMER_REQUESTED' | 'VENDOR_MARKED' | 'SYSTEM';

/** Override row used to compute conflicts and marker info. */
export interface OverrideRow {
  dailySupplyId: bigint;
  actorRole: ActorRole | null;
  newStatus: string | null;
  changedByUserId: bigint | null;
  createdAt: Date;
}

export interface IDeliveryRepository {
  // === DailySupply ===

  /** Tenant-scoped fetch with its extra-charge total folded in. Null masks 404. */
  findById(id: bigint, vendorId: bigint, tx?: PrismaTransaction): Promise<DailySupplyRecord | null>;

  /** Extra-charge sum for a daily supply (0 when none). */
  getExtraChargesTotal(dailySupplyId: bigint, tx?: PrismaTransaction): Promise<number>;

  /** Daily supplies for a list on a date, tenant-scoped. */
  listByListAndDate(
    vendorId: bigint,
    supplyListId: bigint,
    serviceDate: Date,
    filters: { status?: DailySupplyStatus; search?: string },
    tx?: PrismaTransaction
  ): Promise<DailySupplyRecord[]>;

  /** Pending (and optionally auto-marked) ids for a list+date, minus the exclude set. */
  findMarkableIds(
    vendorId: bigint,
    supplyListId: bigint,
    serviceDate: Date,
    excludeIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<bigint[]>;

  /**
   * PENDING daily-supply ids for a service date across all vendors (cron sweep).
   * When `minQuantity` is set, only rows with quantity strictly greater are returned.
   */
  findPendingIdsForDate(
    serviceDate: Date,
    options?: { minQuantity?: number },
    tx?: PrismaTransaction
  ): Promise<bigint[]>;

  /** Load daily-supply records by id without tenant scoping (system sweep only). */
  findByIds(ids: bigint[], tx?: PrismaTransaction): Promise<DailySupplyRecord[]>;

  /** Persist a mark transition + its override atomically. */
  applyMark(
    entity: DailySupplyEntity,
    override: OverrideProps,
    tx?: PrismaTransaction
  ): Promise<void>;

  /** Insert generated rows; skips existing (subscription, date). Returns inserted count. */
  insertGenerated(rows: DailySupplyInsert[], tx?: PrismaTransaction): Promise<number>;

  /** Daily supply rows in a date range for a subscription. */
  findBySubscriptionInRange(
    supplyListCustomerId: bigint,
    startDate: Date,
    endDate: Date,
    tx?: PrismaTransaction
  ): Promise<DailySupplyRecord[]>;

  // === Overrides ===

  /** Latest override rows for a set of daily supplies (for conflict derivation). */
  findOverridesFor(dailySupplyIds: bigint[], tx?: PrismaTransaction): Promise<OverrideRow[]>;

  // === Extra charges ===

  /** Insert an extra charge and bump the parent finalAmount atomically. */
  insertExtraCharge(
    input: {
      dailySupplyId: bigint;
      amount: number;
      comment: string;
      addedByUserId: bigint | null;
      addedByRole: ActorRole | null;
      newFinalAmount: number;
    },
    tx?: PrismaTransaction
  ): Promise<{ id: bigint; createdAt: Date }>;

  // === Leaves ===

  findLeaveById(id: bigint, vendorId: bigint, tx?: PrismaTransaction): Promise<LeaveRecord | null>;

  insertLeave(entity: LeaveEntity, tx?: PrismaTransaction): Promise<{ id: bigint }>;

  deleteLeave(id: bigint, tx?: PrismaTransaction): Promise<void>;

  /** Open leaves covering a date for a subscription (excluding an optional leave id). */
  countCoveringLeaves(
    supplyListCustomerId: bigint,
    date: Date,
    excludeLeaveId: bigint | null,
    tx?: PrismaTransaction
  ): Promise<number>;

  /** Whether an open leave covers a given (subscription, date). */
  hasLeaveCovering(
    supplyListCustomerId: bigint,
    date: Date,
    tx?: PrismaTransaction
  ): Promise<boolean>;

  /** Leaves for a vendor scoped by date window + optional subscription set. */
  listLeaves(
    vendorId: bigint,
    params: { from: Date; to: Date; supplyListCustomerIds?: bigint[] },
    tx?: PrismaTransaction
  ): Promise<LeaveRecord[]>;

  /** Run work in a transaction. */
  transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T>;
}
