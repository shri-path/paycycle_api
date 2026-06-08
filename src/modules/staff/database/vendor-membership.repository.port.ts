import { Prisma, VendorUser, StaffPermission } from '@prisma/client';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

/**
 * A membership row joined with its role name and owned permission grants —
 * the shape the mapper needs to reconstitute the aggregate.
 */
export type VendorMembershipRecord = VendorUser & {
  role: { name: string };
  user?: { name: string | null; phone: string } | null;
  staffPermissions: StaffPermission[];
};

export interface StaffPermissionInput {
  permissionKey: string;
  granted: boolean;
}

export interface MembershipUpdateData {
  status?: VendorUser['status'];
  areaRouteLabel?: string | null;
  disabledAt?: Date | null;
  removedAt?: Date | null;
  joinedAt?: Date | null;
  invitedAt?: Date | null;
  deletedAt?: Date | null;
}

export interface ListMembershipsParams {
  where?: Prisma.VendorUserWhereInput;
  orderBy?: Prisma.VendorUserOrderByWithRelationInput | Prisma.VendorUserOrderByWithRelationInput[];
  skip?: number;
  take?: number;
}

export interface IVendorMembershipRepository {
  findById(id: bigint, tx?: PrismaTransaction): Promise<VendorMembershipRecord | null>;
  findByVendorAndUser(
    vendorId: bigint,
    userId: bigint,
    tx?: PrismaTransaction
  ): Promise<VendorMembershipRecord | null>;
  findByVendorAndPhone(
    vendorId: bigint,
    phone: string,
    tx?: PrismaTransaction
  ): Promise<VendorMembershipRecord | null>;
  listByVendor(
    vendorId: bigint,
    params: ListMembershipsParams,
    tx?: PrismaTransaction
  ): Promise<{ rows: VendorMembershipRecord[]; total: number }>;
  /** Insert a membership plus its permission grants in one operation. */
  insertWithPermissions(
    data: Prisma.VendorUserCreateInput,
    grants: StaffPermissionInput[],
    tx?: PrismaTransaction
  ): Promise<VendorMembershipRecord>;
  update(
    id: bigint,
    data: MembershipUpdateData,
    tx?: PrismaTransaction
  ): Promise<VendorMembershipRecord>;
  /** Replace all permission grants for a membership (delete + recreate). */
  replacePermissions(
    id: bigint,
    grants: StaffPermissionInput[],
    tx?: PrismaTransaction
  ): Promise<void>;
  /** Count non-removed staff (excludes owner + REMOVED) for subscription limits. */
  countActiveStaff(vendorId: bigint, tx?: PrismaTransaction): Promise<number>;
}
