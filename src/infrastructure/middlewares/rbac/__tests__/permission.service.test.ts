/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { PermissionService } from '../permission.service';
import { RoleContext } from '../role-context';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';

function ctx(role: 'owner' | 'staff', permissions: PermissionKey[] = []): RoleContext {
  return {
    role,
    roleName: role === 'owner' ? 'vendor_owner' : 'vendor_staff',
    vendorId: 1n,
    userId: 2n,
    staffId: 5n,
    permissions,
  };
}

describe('PermissionService', () => {
  let port: any;
  let service: PermissionService;

  beforeEach(() => {
    port = {
      isAssignedToList: jest.fn(),
      isCustomerInAssignedList: jest.fn(),
      countAssignedLists: jest.fn(),
      getAssignedListIds: jest.fn(),
      unassignAll: jest.fn(),
    };
    service = new PermissionService(port);
  });

  describe('owner is always allowed', () => {
    it('allows any capability and list-scoped action without touching the port', async () => {
      const owner = ctx('owner');
      expect(service.hasCapability(owner, PermissionKey.MARK_DELIVERIES)).toBe(true);
      await expect(service.canMarkDelivery(owner, 10n)).resolves.toBe(true);
      await expect(service.canViewSupplyList(owner, 10n)).resolves.toBe(true);
      expect(port.isAssignedToList).not.toHaveBeenCalled();
    });
  });

  describe('staff', () => {
    it('hasCapability reflects the granted keys', () => {
      const staff = ctx('staff', [PermissionKey.MARK_DELIVERIES]);
      expect(service.hasCapability(staff, PermissionKey.MARK_DELIVERIES)).toBe(true);
      expect(service.hasCapability(staff, PermissionKey.MARK_LEAVES)).toBe(false);
    });

    it('canMarkDelivery requires BOTH the grant AND a list assignment', async () => {
      const staff = ctx('staff', [PermissionKey.MARK_DELIVERIES]);
      port.isAssignedToList.mockResolvedValue(true);
      await expect(service.canMarkDelivery(staff, 10n)).resolves.toBe(true);

      // Missing grant → denied without consulting the port.
      const noGrant = ctx('staff', []);
      await expect(service.canMarkDelivery(noGrant, 10n)).resolves.toBe(false);
    });

    it('is fail-closed when the stub port reports no assignment (OQ-1)', async () => {
      const staff = ctx('staff', [PermissionKey.MARK_DELIVERIES]);
      port.isAssignedToList.mockResolvedValue(false); // stub behaviour
      await expect(service.canMarkDelivery(staff, 10n)).resolves.toBe(false);
    });

    it('owner-exclusive actions deny staff (edit list, mark payment)', async () => {
      const staff = ctx('staff', [PermissionKey.MARK_DELIVERIES]);
      await expect(service.canEditSupplyList(staff, 10n)).resolves.toBe(false);
      await expect(service.canMarkPayment(staff, 10n)).resolves.toBe(false);
    });
  });
});
