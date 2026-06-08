import { VendorUserStatus } from '@prisma/client';
import { StaffMapper } from '../database/staff.mapper';
import { VendorMembershipRecord } from '../database/vendor-membership.repository.port';
import { StaffInvitationEntity } from '../domain/staff-invitation.entity';
import { InviteToken } from '../domain/value-objects/invite-token.value-object';
import { PermissionKey } from '../domain/value-objects/permission-key.value-object';

function buildRecord(overrides: Partial<VendorMembershipRecord> = {}): VendorMembershipRecord {
  return {
    id: 5n,
    vendorId: 1n,
    userId: 2n,
    roleId: 3n,
    status: VendorUserStatus.ACTIVE,
    phone: '+919000000010',
    areaRouteLabel: 'Route A',
    invitedAt: new Date('2024-01-01'),
    joinedAt: new Date('2024-01-02'),
    disabledAt: null,
    removedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-03'),
    deletedAt: null,
    role: { name: 'vendor_staff' },
    user: { name: 'Asha', phone: '+919000000010' },
    staffPermissions: [
      {
        id: 1n,
        vendorUserId: 5n,
        permissionKey: 'mark_deliveries',
        granted: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    ...overrides,
  } as VendorMembershipRecord;
}

describe('StaffMapper', () => {
  it('toDomain reconstitutes an entity with granted permissions', () => {
    const entity = StaffMapper.toDomain(buildRecord());
    expect(entity.id).toBe(5n);
    expect(entity.grantedPermissions()).toEqual([PermissionKey.MARK_DELIVERIES]);
  });

  it('toResponse whitelists fields and never leaks secrets/internal timestamps', () => {
    const record = buildRecord();
    const dto = StaffMapper.toResponse(StaffMapper.toDomain(record), record, {
      assignedListCount: 0,
      assignedListIds: [],
    });
    expect(dto).toMatchObject({
      staffId: '5',
      userId: '2',
      name: 'Asha',
      role: 'staff',
      status: 'ACTIVE',
      permissions: [PermissionKey.MARK_DELIVERIES],
      assignedListCount: 0,
      assignedListIds: [],
    });
    const keys = Object.keys(dto);
    expect(keys).not.toContain('tokenHash');
    expect(keys).not.toContain('passwordHash');
    expect(keys).not.toContain('deletedAt');
    expect(keys).not.toContain('removedAt');
    expect(keys).not.toContain('disabledAt');
  });

  it('toRoleContext maps owner role to the "owner" label with all permissions', () => {
    const record = buildRecord({ role: { name: 'vendor_owner' } });
    const ctx = StaffMapper.toRoleContext(StaffMapper.toDomain(record));
    expect(ctx.role).toBe('owner');
    expect(ctx.permissions.length).toBe(3);
  });

  it('invitationToResponse builds an invite URL with the raw token (hash never exposed)', () => {
    const { raw, hash } = InviteToken.generate();
    const inv = StaffInvitationEntity.create(
      { vendorId: 1n, vendorUserId: 5n, invitedByUserId: 9n, phone: '+919000000010' },
      raw
    );
    const out = StaffMapper.invitationToResponse(inv, raw);
    expect(out.inviteUrl).toContain(encodeURIComponent(raw));
    expect(out.inviteUrl).not.toContain(hash);
    expect(out.status).toBe('PENDING');
  });
});
