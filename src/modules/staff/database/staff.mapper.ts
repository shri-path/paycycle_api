import { Prisma } from '@prisma/client';
import { config } from '@/infrastructure/config';
import { VendorMembershipEntity } from '../domain/vendor-membership.entity';
import { StaffInvitationEntity } from '../domain/staff-invitation.entity';
import { PermissionKeyVO } from '../domain/value-objects/permission-key.value-object';
import { PermissionGrant, isOwnerRole } from '../domain/vendor-membership.types';
import { StaffResponseDto, StaffRoleLabel, RoleContextDto } from '../staff.types';
import { VendorMembershipRecord, StaffPermissionInput } from './vendor-membership.repository.port';

export interface StaffEnrichment {
  assignedListCount: number;
  assignedListIds: bigint[];
}

function roleLabel(roleName: string): StaffRoleLabel {
  return isOwnerRole(roleName) ? 'owner' : 'staff';
}

export class StaffMapper {
  // === Persistence → Domain ===

  static toDomain(record: VendorMembershipRecord): VendorMembershipEntity {
    const permissions: PermissionGrant[] = record.staffPermissions
      .filter((p) => PermissionKeyVO.isValid(p.permissionKey))
      .map((p) => ({
        key: PermissionKeyVO.from(p.permissionKey),
        granted: p.granted,
      }));

    return VendorMembershipEntity.reconstitute({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        vendorId: record.vendorId,
        userId: record.userId,
        roleId: record.roleId,
        roleName: record.role.name,
        status: record.status,
        phone: record.phone ?? record.user?.phone ?? null,
        areaRouteLabel: record.areaRouteLabel,
        permissions,
        invitedAt: record.invitedAt,
        joinedAt: record.joinedAt,
        disabledAt: record.disabledAt,
        removedAt: record.removedAt,
        deletedAt: record.deletedAt,
      },
    });
  }

  // === Domain → Persistence ===

  /** Membership create input (without owned grants — passed separately). */
  static toPersistence(entity: VendorMembershipEntity): {
    membership: Prisma.VendorUserCreateInput;
    grants: StaffPermissionInput[];
  } {
    const props = entity.getProps();
    return {
      membership: {
        vendor: { connect: { id: props.vendorId } },
        user: { connect: { id: props.userId } },
        role: { connect: { id: props.roleId } },
        status: props.status,
        phone: props.phone,
        areaRouteLabel: props.areaRouteLabel,
        invitedAt: props.invitedAt,
        joinedAt: props.joinedAt,
        disabledAt: props.disabledAt,
        removedAt: props.removedAt,
        deletedAt: props.deletedAt,
      },
      grants: StaffMapper.toGrantInputs(entity),
    };
  }

  static toGrantInputs(entity: VendorMembershipEntity): StaffPermissionInput[] {
    return entity.getProps().permissions.map((g) => ({
      permissionKey: g.key,
      granted: g.granted,
    }));
  }

  // === Domain → Response (WHITELIST) ===

  static toResponse(
    entity: VendorMembershipEntity,
    record: VendorMembershipRecord,
    enrichment: StaffEnrichment
  ): StaffResponseDto {
    const props = entity.getProps();
    return {
      staffId: props.id.toString(),
      userId: props.userId.toString(),
      name: record.user?.name ?? null,
      phone: props.phone,
      role: roleLabel(props.roleName),
      status: props.status,
      areaRouteLabel: props.areaRouteLabel,
      permissions: entity.grantedPermissions(),
      assignedListCount: enrichment.assignedListCount,
      assignedListIds: enrichment.assignedListIds.map((id) => id.toString()),
      todayStats: null, // OQ-9 — deferred to US-006
      invitedAt: props.invitedAt?.toISOString() ?? null,
      joinedAt: props.joinedAt?.toISOString() ?? null,
      createdAt: props.createdAt.toISOString(),
      updatedAt: props.updatedAt.toISOString(),
      // NEVER: tokenHash, passwordHash, deletedAt, removedAt, disabledAt
    };
  }

  static toRoleContext(entity: VendorMembershipEntity): RoleContextDto {
    const props = entity.getProps();
    return {
      role: roleLabel(props.roleName),
      vendorId: props.vendorId.toString(),
      staffId: props.id.toString(),
      permissions: entity.grantedPermissions(),
    };
  }

  // === Invitation → invite URL (raw token only available at creation) ===

  static invitationToResponse(
    invitation: StaffInvitationEntity,
    rawToken: string
  ): { inviteUrl: string; expiresAt: string; status: string } {
    const base = config.appBaseUrl.replace(/\/$/, '');
    const props = invitation.getProps();
    return {
      inviteUrl: `${base}/accept-invite?token=${encodeURIComponent(rawToken)}`,
      expiresAt: props.expiresAt.toISOString(),
      status: props.status,
    };
  }
}
