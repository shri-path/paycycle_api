import { VendorUserStatus } from '@prisma/client';
import { PermissionKey } from './value-objects/permission-key.value-object';

/**
 * A single permission grant on a staff membership.
 */
export interface PermissionGrant {
  key: PermissionKey;
  granted: boolean;
}

export interface VendorMembershipProps {
  vendorId: bigint;
  userId: bigint;
  roleId: bigint;
  /** Role slug resolved from the role table — e.g. 'vendor_owner' | 'vendor_staff'. */
  roleName: string;
  status: VendorUserStatus;
  phone: string | null;
  areaRouteLabel: string | null;
  permissions: PermissionGrant[];
  invitedAt: Date | null;
  joinedAt: Date | null;
  disabledAt: Date | null;
  removedAt: Date | null;
  deletedAt: Date | null;
}

export interface CreateInvitedMembershipProps {
  vendorId: bigint;
  userId: bigint;
  roleId: bigint;
  roleName: string;
  phone: string | null;
  areaRouteLabel: string | null;
  permissions: PermissionGrant[];
}

export interface CreateOwnerMembershipProps {
  vendorId: bigint;
  userId: bigint;
  roleId: bigint;
  roleName: string;
  phone: string | null;
}

export interface ReconstituteMembershipData {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
  props: VendorMembershipProps;
}

/** Role slugs treated as owner (all-allow). */
export const OWNER_ROLE_NAME = 'vendor_owner';
export const STAFF_ROLE_NAME = 'vendor_staff';

export function isOwnerRole(roleName: string): boolean {
  return roleName === OWNER_ROLE_NAME;
}
