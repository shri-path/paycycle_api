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

/** Invite delivery channel (mirrors Prisma StaffInvitationChannel). */
export type InviteChannel = 'whatsapp' | 'sms';

/** POST /vendors/:vendorId/staff/:staffId/resend-invitation response. */
export interface ResendInviteResponseDto {
  inviteUrl: string;
  expiresAt: string;
  sentVia: InviteChannel | null;
}

/**
 * Subscription staff-limit snapshot attached to GET /staff (OQ-7).
 * `maxStaff` null = unlimited (current stub); `canAddMore` reflects the cap.
 */
export interface StaffLimitsDto {
  maxStaff: number | null;
  currentActive: number;
  canAddMore: boolean;
}

/** GET /vendors/:vendorId/staff — list wrapper with limits block. */
export interface ListStaffResponseDto {
  items: StaffResponseDto[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  limits: StaffLimitsDto;
}

/** PATCH /vendors/:vendorId/staff/:staffId/permissions response. */
export interface UpdatePermissionsResponseDto {
  permissions: PermissionGrantDto[];
}

/**
 * POST .../assign-list response (US-005). Unreachable while the write port is the
 * fail-closed stub (503); shaped now so US-005 is a drop-in.
 */
export interface AssignListResponseDto {
  staffId: string;
  supplyListId: string;
  isPrimary: boolean;
}

/** DELETE .../unassign-list/:listId response (US-005). */
export interface UnassignListResponseDto {
  staffId: string;
  listId: string;
  unassigned: boolean;
}
