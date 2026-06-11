import { Prisma, SupplyList, SupplyListStaff, SupplyListSchedule } from '@prisma/client';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { SupplyListEntity } from '../domain/supply-list.entity';

/** A supply-list row joined with its owned staff + schedule. */
export type SupplyListRecord = SupplyList & {
  staff: SupplyListStaff[];
  schedule: SupplyListSchedule[];
};

/** Names of a staff member for the assignedStaff projection. */
export interface AssignedStaffInfo {
  vendorUserId: bigint;
  name: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export interface ListSupplyListsParams {
  /** When set, restrict to active (true) or archived (false). */
  isActive?: boolean;
  /** When set (staff scope), restrict to lists this membership is assigned to. */
  assignedToVendorUserId?: bigint;
  skip: number;
  take: number;
}

export interface ISupplyListRepository {
  /** Tenant-scoped fetch. Returns null for wrong tenant (mask as 404). */
  findById(id: bigint, vendorId: bigint, tx?: PrismaTransaction): Promise<SupplyListRecord | null>;

  /** Case-insensitive active-name lookup for duplicate detection (OQ-5). */
  findActiveByName(
    vendorId: bigint,
    name: string,
    tx?: PrismaTransaction
  ): Promise<SupplyListRecord | null>;

  list(
    vendorId: bigint,
    params: ListSupplyListsParams,
    tx?: PrismaTransaction
  ): Promise<{ rows: SupplyListRecord[]; total: number }>;

  /** Insert list + nested staff + schedule atomically. */
  insert(entity: SupplyListEntity, tx?: PrismaTransaction): Promise<SupplyListRecord>;

  /** Focused detail update (list columns + replace schedule). */
  updateDetails(entity: SupplyListEntity, tx?: PrismaTransaction): Promise<SupplyListRecord>;

  /** Archive (soft): isActive=false, deletedAt=now. */
  archive(id: bigint, tx?: PrismaTransaction): Promise<void>;

  // === Staff assignment writes ===
  assignStaff(
    supplyListId: bigint,
    vendorUserId: bigint,
    isPrimary: boolean,
    assignedByUserId: bigint | null,
    tx?: PrismaTransaction
  ): Promise<void>;
  unassignStaff(supplyListId: bigint, vendorUserId: bigint, tx?: PrismaTransaction): Promise<void>;
  demoteOtherPrimaries(
    supplyListId: bigint,
    keepVendorUserId: bigint,
    tx?: PrismaTransaction
  ): Promise<void>;

  // === Projections (batched, no N+1) ===
  /** Map of supplyListId → active customer count. */
  countActiveCustomers(
    supplyListIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<Map<string, number>>;
  /** Map of supplyListId → assigned staff (names batch-loaded). */
  assignedStaffFor(
    supplyListIds: bigint[],
    tx?: PrismaTransaction
  ): Promise<Map<string, AssignedStaffInfo[]>>;
  /** Schedule day numbers for a single list (weekly/monthly). */
  scheduleDays(record: SupplyListRecord): number[];

  /** Lists (id IN) the caller membership is assigned to (staff scope). */
  assignedListIdsFor(vendorUserId: bigint, tx?: PrismaTransaction): Promise<bigint[]>;
}

export type SupplyListWhere = Prisma.SupplyListWhereInput;
