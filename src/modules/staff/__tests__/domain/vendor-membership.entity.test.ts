import { VendorUserStatus } from '@prisma/client';
import { ForbiddenError } from '@/common/errors/app-error';
import { VendorMembershipEntity } from '../../domain/vendor-membership.entity';
import { PermissionKey } from '../../domain/value-objects/permission-key.value-object';
import { InvalidStatusTransitionError } from '../../domain/staff.errors';
import { OWNER_ROLE_NAME, STAFF_ROLE_NAME } from '../../domain/vendor-membership.types';

function buildStaff(): VendorMembershipEntity {
  return VendorMembershipEntity.createInvited({
    vendorId: 1n,
    userId: 2n,
    roleId: 3n,
    roleName: STAFF_ROLE_NAME,
    phone: '+919000000010',
    areaRouteLabel: 'Route A',
    permissions: [{ key: PermissionKey.MARK_DELIVERIES, granted: true }],
  });
}

describe('VendorMembershipEntity', () => {
  describe('createInvited', () => {
    it('creates an INVITED staff with invitedAt set and granted permissions', () => {
      const e = buildStaff();
      const props = e.getProps();
      expect(props.status).toBe(VendorUserStatus.INVITED);
      expect(props.invitedAt).toBeInstanceOf(Date);
      expect(props.joinedAt).toBeNull();
      expect(e.grantedPermissions()).toEqual([PermissionKey.MARK_DELIVERIES]);
      expect(e.isOwner).toBe(false);
    });

    it('rejects an area label over 200 chars', () => {
      expect(() =>
        VendorMembershipEntity.createInvited({
          vendorId: 1n,
          userId: 2n,
          roleId: 3n,
          roleName: STAFF_ROLE_NAME,
          phone: null,
          areaRouteLabel: 'x'.repeat(201),
          permissions: [],
        })
      ).toThrow(/areaRouteLabel/);
    });
  });

  describe('createOwner', () => {
    it('creates an ACTIVE owner that reports all permission keys', () => {
      const owner = VendorMembershipEntity.createOwner({
        vendorId: 1n,
        userId: 2n,
        roleId: 9n,
        roleName: OWNER_ROLE_NAME,
        phone: null,
      });
      expect(owner.isOwner).toBe(true);
      expect(owner.status).toBe(VendorUserStatus.ACTIVE);
      expect(owner.grantedPermissions()).toEqual(
        expect.arrayContaining([
          PermissionKey.MARK_DELIVERIES,
          PermissionKey.MARK_LEAVES,
          PermissionKey.ADD_EXTRA_CHARGES,
        ])
      );
    });
  });

  describe('state transitions', () => {
    it('activates INVITED → ACTIVE and emits StaffJoinedEvent', () => {
      const e = buildStaff();
      e.activate('corr-1');
      expect(e.status).toBe(VendorUserStatus.ACTIVE);
      expect(e.getProps().joinedAt).toBeInstanceOf(Date);
      expect(e.getDomainEvents().map((ev) => ev.type)).toContain('StaffJoinedEvent');
    });

    it('disables ACTIVE → DISABLED and emits StaffDisabledEvent', () => {
      const e = buildStaff();
      e.activate('c');
      e.clearDomainEvents();
      e.disable(99n, 'c');
      expect(e.status).toBe(VendorUserStatus.DISABLED);
      expect(e.getProps().disabledAt).toBeInstanceOf(Date);
      expect(e.getDomainEvents().map((ev) => ev.type)).toContain('StaffDisabledEvent');
    });

    it('enables DISABLED → ACTIVE', () => {
      const e = buildStaff();
      e.activate('c');
      e.disable(99n, 'c');
      e.enable('c');
      expect(e.status).toBe(VendorUserStatus.ACTIVE);
      expect(e.getProps().disabledAt).toBeNull();
    });

    it('removes ACTIVE → REMOVED (terminal) and sets deletedAt', () => {
      const e = buildStaff();
      e.activate('c');
      e.remove(99n, 'c');
      expect(e.status).toBe(VendorUserStatus.REMOVED);
      expect(e.getProps().deletedAt).toBeInstanceOf(Date);
      expect(e.getDomainEvents().map((ev) => ev.type)).toContain('StaffRemovedEvent');
    });

    it('rejects an illegal transition (disable from INVITED) with 422', () => {
      const e = buildStaff(); // INVITED — cannot go straight to DISABLED
      expect(() => e.disable(99n, 'c')).toThrow(InvalidStatusTransitionError);
    });

    it('cannot transition out of REMOVED (terminal)', () => {
      const e = buildStaff();
      e.activate('c');
      e.remove(99n, 'c');
      expect(() => e.enable('c')).toThrow(InvalidStatusTransitionError);
    });
  });

  describe('owner guards (OQ-6)', () => {
    const owner = (): VendorMembershipEntity =>
      VendorMembershipEntity.createOwner({
        vendorId: 1n,
        userId: 2n,
        roleId: 9n,
        roleName: OWNER_ROLE_NAME,
        phone: null,
      });

    it('cannot disable an owner', () => {
      expect(() => owner().disable(1n, 'c')).toThrow(ForbiddenError);
    });

    it('cannot remove an owner', () => {
      expect(() => owner().remove(1n, 'c')).toThrow(ForbiddenError);
    });

    it('ignores permission grants on an owner (all-allow)', () => {
      const o = owner();
      o.setPermissions([{ key: PermissionKey.MARK_DELIVERIES, granted: false }], 'c');
      // still reports all keys
      expect(o.grantedPermissions()).toContain(PermissionKey.MARK_DELIVERIES);
    });
  });

  describe('setPermissions', () => {
    it('replaces grants and emits StaffPermissionsChangedEvent for staff', () => {
      const e = buildStaff();
      e.clearDomainEvents();
      e.setPermissions(
        [
          { key: PermissionKey.MARK_LEAVES, granted: true },
          { key: PermissionKey.MARK_DELIVERIES, granted: false },
        ],
        'c'
      );
      expect(e.grantedPermissions()).toEqual([PermissionKey.MARK_LEAVES]);
      expect(e.getDomainEvents().map((ev) => ev.type)).toContain('StaffPermissionsChangedEvent');
    });
  });

  describe('reinvite (OQ-8)', () => {
    it('moves a REMOVED membership back to INVITED with new grants', () => {
      const e = buildStaff();
      e.activate('c');
      e.remove(99n, 'c');
      e.reinvite([{ key: PermissionKey.ADD_EXTRA_CHARGES, granted: true }], 'Route B');
      expect(e.status).toBe(VendorUserStatus.INVITED);
      expect(e.getProps().deletedAt).toBeNull();
      expect(e.getProps().removedAt).toBeNull();
      expect(e.grantedPermissions()).toEqual([PermissionKey.ADD_EXTRA_CHARGES]);
    });
  });
});
