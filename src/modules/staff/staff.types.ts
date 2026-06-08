import { VendorUserStatus } from '@prisma/client';
import { PermissionKey } from './domain/value-objects/permission-key.value-object';

/** Caller-facing role label (mapped from role slug). */
export type StaffRoleLabel = 'owner' | 'staff';

export interface PermissionGrantDto {
  key: PermissionKey;
  granted: boolean;
}

/**
 * Staff detail response (whitelist). BigInt → string. No tokenHash/passwordHash.
 */
export interface StaffResponseDto {
  staffId: string;
  userId: string | null;
  name: string | null;
  phone: string | null;
  role: StaffRoleLabel;
  status: VendorUserStatus;
  areaRouteLabel: string | null;
  permissions: PermissionKey[];
  assignedListCount: number;
  assignedListIds: string[];
  todayStats: TodayStatsDto | null;
  invitedAt: string | null;
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Placeholder until US-006 delivery stats (OQ-9). */
export interface TodayStatsDto {
  deliveriesMarked: number;
  leavesMarked: number;
}

/** GET /vendors/:vendorId/role */
export interface RoleContextDto {
  role: StaffRoleLabel;
  vendorId: string;
  staffId: string | null;
  permissions: PermissionKey[];
}

/** POST /vendors/:vendorId/staff/invite response. */
export interface InviteStaffResponseDto {
  staff: StaffResponseDto;
  inviteUrl: string;
  expiresAt: string;
}

/** DELETE /vendors/:vendorId/staff/:staffId response (OQ-3, 200 + summary). */
export interface RemoveStaffResponseDto {
  staffId: string;
  status: VendorUserStatus;
  removedAt: string | null;
}
